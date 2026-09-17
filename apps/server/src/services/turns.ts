import { randomUUID } from 'node:crypto';
import { fallbackPlan, validatePlan, type AgentRuntime, type BaseAgentRequest, type TracePhase } from '@new-ai-chat/agent-runtime';
import type { TurnRequest, TurnRecord, TurnPlan, SpeakerRef, TurnProgress, InterruptedOutput } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import { EventBroker } from './events.js';
import { StoryContext } from './context.js';
import type { InternalPluginHost } from './plugins.js';

export class TurnService {
  private active = new Map<string, { id: string; controller: AbortController; done: Promise<void> }>();
  constructor(readonly repository: Repository, readonly runtime: AgentRuntime, readonly events: EventBroker,
    private postprocess: (chat: string, signal: AbortSignal, trace?: BaseAgentRequest['trace']) => Promise<void> = async () => {}, private plugins?: InternalPluginHost) {}
  busy(chat: string) { return this.active.has(chat); }
  assertIdle(chat: string) { if (this.busy(chat)) throw Object.assign(new Error('Generation is active. Stop it before editing this conversation.'), { statusCode: 409 }); }
  async idle(chat: string) { await this.active.get(chat)?.done; }
  async shutdown() { for (const task of this.active.values()) task.controller.abort(); await Promise.all([...this.active.values()].map((task) => task.done)); }
  cancel(id: string): boolean { const task = [...this.active.values()].find((task) => task.id === id); task?.controller.abort(); return Boolean(task); }

  start(request: TurnRequest, swipe = false): TurnRecord {
    const chat = this.repository.getConversation(request.conversationId);
    if (!chat) throw new Error('Conversation not found.');
    this.assertIdle(chat.id);
    if (!this.repository.resolveConnection()) throw new Error('请在左下角通用设置中选择模型连接。');
    const source = new StoryContext(this.repository, chat.id);
    const fullHistory = this.repository.getActiveBranch(chat.id);
    const explicit = request.replyTarget.mode === 'explicit' ? request.replyTarget.speaker : null;
    if (explicit?.kind === 'character' && !source.cast.some((c) => c.id === explicit.characterId)) throw new Error('Speaker is not in this conversation.');
    const target = request.targetMessageId ? this.repository.getMessage(request.targetMessageId) : null;
    if (request.trigger === 'continue' || request.trigger === 'regenerate') {
      if (!target || target.conversationId !== chat.id || target.role !== 'assistant' || !fullHistory.some((m) => m.id === target.id)) throw new Error('Target must be an assistant message on the current branch.');
    }
    const storyTurnId = target?.storyTurnId ?? randomUUID();
    const turn = this.repository.createTurn(chat.id, storyTurnId, request.trigger);
    let parent = chat.headMessageId;
    let continueText = '';
    let forced: SpeakerRef | null = explicit;
    this.repository.database.sqlite.transaction(() => {
      if (request.input && request.trigger === 'normal') {
        parent = this.repository.createMessage({ conversationId: chat.id, parentId: parent, storyTurnId, role: 'user',
          authorKind: request.input.voice === 'narrator' ? 'user_narrator' : 'protagonist', speaker: null,
          content: request.input.text, providerState: null, legacyPayload: null }).id;
      } else if (target && request.trigger === 'regenerate') {
        const first = swipe ? target : fullHistory.find((m) => m.storyTurnId === target.storyTurnId && m.role === 'assistant') ?? target;
        parent = first.parentId; if (swipe) forced = target.speaker;
      } else if (target && request.trigger === 'continue') {
        parent = target.parentId; continueText = target.content; forced = target.speaker;
      }
      this.repository.setHead(chat.id, request.trigger === 'continue' ? target!.id : parent);
    })();
    const progress: TurnProgress = { request, head: this.repository.getConversation(chat.id)!.headMessageId, parent, oldHead: chat.headMessageId,
      prefix: continueText, swipe, completedMessageIds: [], interruptedOutputs: [] };
    return this.launch(this.repository.updateTurn(turn.id, { progress }));
  }

  retry(id: string): TurnRecord {
    const previous = this.repository.getTurn(id);
    if (!previous?.progress || !['partial', 'failed', 'cancelled'].includes(previous.status)) throw new Error('此回合没有可重试的输出。');
    this.assertIdle(previous.conversationId);
    if (!this.repository.resolveConnection()) throw new Error('请在左下角通用设置中选择模型连接。');
    const progress = structuredClone(previous.progress);
    if (this.repository.getConversation(previous.conversationId)?.headMessageId !== progress.head) throw new Error('当前分支已变化，请返回原分支后重试。');
    if (previous.plan) validatePlan(previous.plan, previous.storyTurnId, new StoryContext(this.repository, previous.conversationId).cast);
    const turn = this.repository.database.sqlite.transaction(() => {
      const next = this.repository.createTurn(previous.conversationId, previous.storyTurnId, previous.trigger);
      if (!progress.completedMessageIds.length && previous.trigger !== 'continue') {
        progress.head = progress.parent; this.repository.setHead(previous.conversationId, progress.head);
      }
      progress.interruptedOutputs = [];
      return this.repository.updateTurn(next.id, { plan: previous.plan, progress });
    })();
    return this.launch(turn);
  }

  private launch(turn: TurnRecord): TurnRecord {
    const controller = new AbortController();
    const task = { id: turn.id, controller, done: Promise.resolve() };
    this.active.set(turn.conversationId, task);
    // Defer work until after registration, so sync fake providers follow the same lifecycle.
    task.done = Promise.resolve().then(() => this.run(turn, controller.signal)).finally(() => this.active.delete(turn.conversationId));
    return turn;
  }

  async request(chatId: string, storyTurnId: string, signal: AbortSignal, auto = false, virtualInput?: TurnRequest['input']): Promise<BaseAgentRequest> {
    const chat = this.repository.getConversation(chatId)!;
    const settings = this.repository.getGeneralSettings();
    const connection = this.repository.resolveConnection();
    if (!connection) throw new Error('请在左下角通用设置中选择模型连接。');
    const virtualMessage = virtualInput ? { id: `preview-${storyTurnId}`, conversationId: chatId, parentId: chat.headMessageId, storyTurnId, role: 'user' as const,
      authorKind: virtualInput.voice === 'narrator' ? 'user_narrator' as const : 'protagonist' as const, speaker: null, content: virtualInput.text,
      providerState: null, generationInfo: null, legacyPayload: null, createdAt: new Date().toISOString() } : undefined;
    const source = new StoryContext(this.repository, chatId, virtualMessage);
    const latest = virtualMessage ?? [...this.repository.getActiveBranch(chatId)].reverse().find((m) => m.role === 'user');
    const persona = this.repository.resolvePersona(chat.personaId);
    const request: BaseAgentRequest = { connection, conversationId: chatId, storyTurnId,
      conversationKind: chat.kind, scenario: chat.scenario, streaming: settings.streaming,
      agencyMode: settings.agencyMode, narrator: settings.narrator, characters: source.cast, persona,
      history: source.history, stableLore: source.stableLore(), dynamicContext: await source.dynamic(source.history.slice(-20).map((m) => m.content).join('\n')),
      latestUserText: auto ? '' : latest?.content ?? '', latestUserIsNarration: latest?.authorKind === 'user_narrator', source, signal,
      promptSettings: this.repository.getPromptSettings() };
    return this.plugins ? this.plugins.enrich(request) : request;
  }

  async preview(input: TurnRequest, signal: AbortSignal) {
    if (input.trigger !== 'normal' && input.trigger !== 'auto') throw new Error('Prompt preview supports normal send and auto continue only.');
    const chat = this.repository.getConversation(input.conversationId);
    if (!chat) throw new Error('Conversation not found.');
    this.assertIdle(chat.id);
    const request = await this.request(chat.id, `preview-${Date.now()}`, signal, input.trigger === 'auto', input.trigger === 'normal' ? input.input : undefined);
    const forced = input.replyTarget.mode === 'explicit' ? input.replyTarget.speaker : null;
    if (forced?.kind === 'character' && !request.characters.some((character) => character.id === forced.characterId)) throw new Error('Speaker is not in this conversation.');
    const mode = this.repository.getGeneralSettings().generationMode;
    if (mode === 'plain' && !forced && chat.kind === 'group') throw new Error('普通写作的群聊需要先手动选择角色或旁白。');
    const plan = forced ? { ...fallbackPlan(request.storyTurnId, request.characters, { mode: 'explicit', speaker: forced }), warnings: [] } : undefined;
    const preview = await this.runtime.previewFirstRequest(request, mode, plan);
    return { action: input.trigger, generationMode: mode, protocol: request.connection.protocol, personaName: request.persona?.name ?? null, ...preview };
  }

  private async run(turn: TurnRecord, signal: AbortSignal) {
    const progress = turn.progress!;
    const { request: input, prefix, swipe, oldHead } = progress;
    const target = input.targetMessageId ? this.repository.getMessage(input.targetMessageId) : null;
    const forced = input.replyTarget.mode === 'explicit' ? input.replyTarget.speaker : (swipe || input.trigger === 'continue') ? target?.speaker ?? null : null;
    let parent = progress.parent;
    let expectedHead = progress.head;
    const offset = progress.completedMessageIds.length;
    let settled = false;
    const live = new Map<number, Omit<InterruptedOutput, 'outputIndex'>>();
    const emit = (type: string, data: unknown = {}) => this.events.publish(turn.conversationId, turn.id, type, { turnId: turn.id, storyTurnId: turn.storyTurnId, ...data as object });
    const emitVolatile = (type: string, data: unknown = {}) => this.events.publishVolatile(turn.conversationId, turn.id, type, { turnId: turn.id, storyTurnId: turn.storyTurnId, ...data as object });
    const fresh = () => { signal.throwIfAborted(); if (this.repository.getConversation(turn.conversationId)?.headMessageId !== expectedHead) throw new Error('Branch changed; discarded stale generation.'); };
    try {
      this.repository.updateTurn(turn.id, { status: 'running' }); emit('turn.started');
      const request = await this.request(turn.conversationId, turn.storyTurnId, signal, input.trigger === 'auto' || input.trigger === 'continue');
      const chat = this.repository.getConversation(turn.conversationId)!;
      const mode = this.repository.getGeneralSettings().generationMode;
      let actualMode = mode;
      let plan: TurnPlan | null = turn.plan ?? (forced ? { ...fallbackPlan(turn.storyTurnId, request.characters, { mode: 'explicit', speaker: forced }), warnings: [] } : null);
      let requestIndex = 0;
      const traceSink = {
        start: (phase: TracePhase, model: string, speaker?: SpeakerRef) => {
          const index = requestIndex++;
          const trace = this.repository.createTrace({ conversationId: turn.conversationId, turnId: turn.id, phase, requestIndex: index, status: 'running', model, speaker: speaker ?? null, request: null, response: null, tools: [], thinking: null, usage: null, timing: { preparedAt: new Date().toISOString(), sentAt: null, headersAt: null, firstThinkingAt: null, firstTextAt: null, completedAt: null }, error: null });
          emit('trace.started', { traceId: trace.id, phase, requestIndex: index, model, speaker }); return trace.id;
        },
        request: (traceId: string, payload: unknown) => { this.repository.updateTrace(traceId, { request: payload }); emit('trace.request', { traceId }); },
        response: (traceId: string, response: unknown) => { this.repository.updateTrace(traceId, { response }); emit('trace.response', { traceId }); },
        thinking: (traceId: string, text: string) => { this.repository.updateTrace(traceId, { thinking: text }); emit('agent.thinking', { traceId, text }); },
        timing: (traceId: string, timing: any) => {
          const current = this.repository.listTraces(turn.id).find((item) => item.id === traceId);
          if (current?.timing) this.repository.updateTrace(traceId, { timing: { ...current.timing, ...timing } });
        },
        tool: (traceId: string, name: string, args: unknown, result?: unknown, ok = true) => {
          const current = this.repository.listTraces(turn.id).find((item) => item.id === traceId);
          this.repository.updateTrace(traceId, { tools: [...(current?.tools ?? []), { name, arguments: args, result, ok }] });
          emit('tool.called', { phase: 'writer', traceId, name, args, ok });
        },
        finish: (traceId: string, status: 'completed' | 'failed' | 'cancelled', usage?: any, error?: string) => {
          const knownUsage = usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens].some((value: number) => value > 0) ? usage : null;
          this.repository.updateTrace(traceId, { status, usage: knownUsage, error: error ?? null, completedAt: new Date().toISOString() });
          emit('trace.completed', { traceId, status, usage, error });
        },
      };
      if (mode === 'plain' && !forced && chat.kind === 'group') throw new Error('普通写作的群聊需要先手动选择角色或旁白。');
      if (mode === 'plain' && !plan) { plan = fallbackPlan(turn.storyTurnId, request.characters); plan.warnings = []; }
      if (mode === 'planner' && !forced && !plan) {
        try {
          const routed = { ...request, trace: traceSink, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), plannerEnabled: true };
          const onTool = (name: string, args: unknown) => emit('tool.called', { phase: 'planner', name, args });
          plan = validatePlan(await this.runtime.plan(routed, onTool), turn.storyTurnId, request.characters);
          emit('planner.completed', { plan });
        } catch (error) {
          fresh(); plan = fallbackPlan(turn.storyTurnId, request.characters); plan.warnings = ['Planner failed; used the current character.']; emit('planner.fallback', { reason: this.repository.redactError(error) });
        }
      }
      const started = new Set<number>();
      const snapshot = () => this.events.setSnapshot(turn.id, { outputs: [...live.entries()].map(([outputIndex, value]) => ({ outputIndex, ...value })) });
      const startOutput = (speaker: SpeakerRef, outputIndex: number) => { if (started.has(outputIndex)) return; started.add(outputIndex); live.set(outputIndex, { speaker, text: '', thinking: '' }); snapshot(); emit('writer.started', { speaker, outputIndex }); };
      const savePlan = (value: TurnPlan) => { plan = validatePlan(value, turn.storyTurnId, request.characters); this.repository.updateTurn(turn.id, { plan }); };
      if (plan) savePlan(plan);
      const saveOutput = (result: Awaited<ReturnType<AgentRuntime['writeTurn']>>['results'][number], localIndex: number) => {
        const outputIndex = offset + localIndex;
        if (progress.completedMessageIds[outputIndex]) return;
        if (!plan || outputIndex !== progress.completedMessageIds.length) throw new Error('Invalid output sequence.');
        const output = plan.outputs[outputIndex]!;
        fresh(); startOutput(output.speaker, outputIndex);
        this.repository.database.sqlite.transaction(() => {
          const message = this.repository.createMessage({ conversationId: turn.conversationId, parentId: parent, storyTurnId: turn.storyTurnId,
            role: 'assistant', authorKind: output.speaker.kind, speaker: output.speaker, content: outputIndex === 0 ? prefix + result.text : result.text,
            providerState: outputIndex === 0 && !prefix ? result.providerState : null,
            generationInfo: { mode: actualMode, model: request.connection.model, streaming: request.streaming ?? true, thinking: result.thinking || null,
              usage: [result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheWrite, result.usage.totalTokens].some(value => value > 0) ? result.usage : null,
              timing: result.timing, requestCount: result.requestCount }, legacyPayload: null });
          parent = expectedHead = progress.parent = progress.head = message.id;
          progress.completedMessageIds.push(message.id);
          this.repository.setHead(turn.conversationId, message.id);
          this.repository.updateTurn(turn.id, { progress });
          emit('message.completed', { message: { ...message, providerState: null }, outputIndex, usage: result.usage });
          live.delete(outputIndex); snapshot();
        })();
      };
      const runWriter = async (writerMode: 'plain' | 'writer-agent', forcedPlan?: TurnPlan) => {
        const writerOptions: Parameters<AgentRuntime['writeTurn']>[1] = {
          mode: writerMode, prefix: offset ? '' : prefix,
          onPhase: (phase, detail) => {
            emit('agent.phase', { phase, detail });
            if (phase === 'writing' && detail && typeof detail === 'object' && 'outputs' in detail) {
              if (!offset) savePlan(detail as TurnPlan);
              startOutput(plan!.outputs[offset]!.speaker, offset);
            }
          },
          onDelta: (speaker, index, delta) => { const outputIndex = offset + index; fresh(); startOutput(speaker, outputIndex); const value = live.get(outputIndex)!; value.text += delta; snapshot(); emitVolatile('writer.delta', { speaker, outputIndex, delta }); },
          onTool: (name, args, outputIndex) => emit('tool.called', { phase: 'writer', outputIndex, name, args }),
          onThinkingDelta: (delta, index) => { const outputIndex = offset + index; const value = live.get(outputIndex); if (value) { value.thinking += delta; snapshot(); } emitVolatile('thinking.delta', { outputIndex, delta }); },
          onOutputComplete: saveOutput,
        };
        if (forcedPlan) writerOptions.forcedPlan = { ...forcedPlan, outputs: forcedPlan.outputs.slice(offset) };
        return this.runtime.writeTurn({ ...request, trace: traceSink, signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) }, writerOptions);
      };
      let generated;
      try {
        generated = plan && offset === plan.outputs.length ? { plan, results: [] } : await runWriter(mode === 'plain' ? 'plain' : 'writer-agent', plan ?? undefined);
      } catch (error) {
        const reason = this.repository.redactError(error);
        if (!forced && mode === 'writer-agent' && !plan && /select_output_voices|valid selection/iu.test(reason)) {
          fresh(); plan = fallbackPlan(turn.storyTurnId, request.characters); plan.warnings = ['Writer Agent selection failed; used plain writing with the current character.']; emit('routing.fallback', { reason });
          actualMode = 'plain'; generated = await runWriter('plain', plan);
        } else throw error;
      }
      const finalPlan = validatePlan(offset ? plan : generated.plan, turn.storyTurnId, request.characters);
      plan = finalPlan;
      this.repository.updateTurn(turn.id, { plan: finalPlan });
      if (mode !== 'planner' && !forced) emit(mode === 'plain' ? 'plain.completed' : 'routing.completed', { plan: finalPlan });
      for (const [index, result] of generated.results.entries()) saveOutput(result, index);
      fresh();
      this.repository.database.sqlite.transaction(() => {
        this.repository.createProposals(turn.conversationId, finalPlan);
        if (finalPlan.protagonistStateProposals.length || finalPlan.worldEventProposals.length) emit('proposals.ready', { plan: finalPlan });
        emit('story.settled', { head: expectedHead, variant: input.trigger === 'continue' || swipe });
        this.repository.updateTurn(turn.id, { status: 'completed', completedAt: new Date().toISOString() });
      })();
      settled = true;
      if (input.trigger !== 'continue' && !swipe) {
        this.repository.updateTurn(turn.id, { recordsStatus: 'running' }); emit('records.started');
        try {
          await this.postprocess(turn.conversationId, signal, traceSink);
          signal.throwIfAborted(); await this.plugins?.settled(turn.conversationId);
          this.repository.updateTurn(turn.id, { recordsStatus: 'completed' }); emit('records.completed');
        } catch (error) {
          const recordsStatus = signal.aborted ? 'cancelled' : 'failed';
          this.repository.updateTurn(turn.id, { recordsStatus });
          emit(`records.${recordsStatus}`, { error: signal.aborted ? null : this.repository.redactError(error) });
        }
      }
      this.repository.pruneTraces(turn.conversationId, 20);
      emit('turn.completed');
    } catch (error) {
      if (settled) { emit('turn.completed'); return; }
      if (!progress.completedMessageIds.length && input.trigger !== 'normal' && this.repository.getConversation(turn.conversationId)?.headMessageId === expectedHead) {
        this.repository.setHead(turn.conversationId, oldHead); progress.head = oldHead;
      }
      progress.interruptedOutputs = [...live.entries()].filter(([, value]) => value.text || value.thinking).map(([outputIndex, value]) => ({ outputIndex, ...value }));
      const message = signal.aborted ? null : this.repository.redactError(error);
      const status = progress.completedMessageIds.length ? 'partial' : signal.aborted ? 'cancelled' : 'failed';
      this.repository.updateTurn(turn.id, { status, progress, error: message, completedAt: new Date().toISOString() });
      this.repository.pruneTraces(turn.conversationId, 20);
      emit(`turn.${status}`, { error: message });
    } finally { this.events.clearSnapshot(turn.id); }
  }
}
