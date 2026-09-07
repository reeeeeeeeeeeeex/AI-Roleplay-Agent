import { randomUUID } from 'node:crypto';
import { fallbackPlan, validatePlan, type AgentRuntime, type BaseAgentRequest } from '@new-ai-chat/agent-runtime';
import type { TurnRequest, TurnRecord, TurnPlan, SpeakerRef } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import { EventBroker } from './events.js';
import { StoryContext } from './context.js';
import type { InternalPluginHost } from './plugins.js';

export class TurnService {
  private active = new Map<string, { id: string; controller: AbortController; done: Promise<void> }>();
  constructor(readonly repository: Repository, readonly runtime: AgentRuntime, readonly events: EventBroker,
    private postprocess: (chat: string, signal: AbortSignal) => Promise<void> = async () => {}, private plugins?: InternalPluginHost) {}
  busy(chat: string) { return this.active.has(chat); }
  assertIdle(chat: string) { if (this.busy(chat)) throw Object.assign(new Error('Generation is active. Stop it before editing this conversation.'), { statusCode: 409 }); }
  async idle(chat: string) { await this.active.get(chat)?.done; }
  async shutdown() { for (const task of this.active.values()) task.controller.abort(); await Promise.all([...this.active.values()].map((task) => task.done)); }
  cancel(id: string): boolean { const task = [...this.active.values()].find((task) => task.id === id); task?.controller.abort(); return Boolean(task); }

  start(request: TurnRequest, swipe = false): TurnRecord {
    const chat = this.repository.getConversation(request.conversationId);
    if (!chat) throw new Error('Conversation not found.');
    this.assertIdle(chat.id);
    if (!this.repository.resolveConnection(chat.connectionId)) throw new Error('请在设置中选择默认模型连接，或在聊天设置中指定连接。');
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
    const controller = new AbortController();
    const task = { id: turn.id, controller, done: Promise.resolve() };
    this.active.set(chat.id, task);
    // Defer work until after registration, so sync fake providers follow the same lifecycle.
    task.done = Promise.resolve().then(() => this.run(turn, request, parent, forced, continueText, swipe, chat.headMessageId, controller.signal)).finally(() => this.active.delete(chat.id));
    return turn;
  }

  async request(chatId: string, storyTurnId: string, signal: AbortSignal, auto = false): Promise<BaseAgentRequest> {
    const chat = this.repository.getConversation(chatId)!;
    const connection = this.repository.resolveConnection(chat.connectionId);
    if (!connection) throw new Error('请在设置中选择默认模型连接，或在聊天设置中指定连接。');
    const source = new StoryContext(this.repository, chatId);
    const latest = [...this.repository.getActiveBranch(chatId)].reverse().find((m) => m.role === 'user');
    const persona = chat.personaId ? this.repository.getPersona(chat.personaId) : null;
    const request: BaseAgentRequest = { connection, conversationId: chatId, storyTurnId,
      agencyMode: chat.agencyMode, narrator: chat.narrator, characters: source.cast, persona,
      history: source.history, stableLore: source.stableLore(), dynamicContext: await source.dynamic(source.history.slice(-20).map((m) => m.content).join('\n')),
      latestUserText: auto ? '' : latest?.content ?? '', latestUserIsNarration: latest?.authorKind === 'user_narrator', source, signal };
    return this.plugins ? this.plugins.enrich(request) : request;
  }

  private async run(turn: TurnRecord, input: TurnRequest, parent: string | null, forced: SpeakerRef | null, prefix: string, swipe: boolean, oldHead: string | null, signal: AbortSignal) {
    let expectedHead = this.repository.getConversation(turn.conversationId)!.headMessageId;
    let wrote = false;
    const emit = (type: string, data: unknown = {}) => this.events.publish(turn.conversationId, turn.id, type, { turnId: turn.id, storyTurnId: turn.storyTurnId, ...data as object });
    const fresh = () => { signal.throwIfAborted(); if (this.repository.getConversation(turn.conversationId)?.headMessageId !== expectedHead) throw new Error('Branch changed; discarded stale generation.'); };
    try {
      this.repository.updateTurn(turn.id, { status: 'running' }); emit('turn.started');
      const request = await this.request(turn.conversationId, turn.storyTurnId, signal, input.trigger === 'auto');
      const plannerEnabled = this.repository.getConversation(turn.conversationId)!.plannerEnabled;
      let plan: TurnPlan;
      if (forced) plan = { ...fallbackPlan(turn.storyTurnId, request.characters, { mode: 'explicit', speaker: forced }), warnings: [] };
      else {
        try {
          const routed = { ...request, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), plannerEnabled };
          const onTool = (name: string, args: unknown) => emit('tool.called', { phase: plannerEnabled ? 'planner' : 'routing', name, args });
          plan = validatePlan(await (plannerEnabled ? this.runtime.plan(routed, onTool) : this.runtime.route(routed, onTool)), turn.storyTurnId, request.characters);
          if (!plannerEnabled) { plan.protagonistStateProposals = []; plan.worldEventProposals = []; }
        } catch (error) {
          fresh(); plan = fallbackPlan(turn.storyTurnId, request.characters);
          plan.warnings = ['Routing failed; used the current character.']; emit('routing.fallback', { reason: this.repository.redactError(error) });
        }
      }
      fresh(); this.repository.updateTurn(turn.id, { plan }); emit(plannerEnabled ? 'planner.completed' : 'routing.completed', { plan });
      for (const [outputIndex, output] of plan.outputs.entries()) {
        fresh(); emit('writer.started', { speaker: output.speaker, outputIndex });
        const latest = await this.request(turn.conversationId, turn.storyTurnId, signal, input.trigger === 'auto');
        const result = await this.runtime.write({ ...latest, signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
          speaker: output.speaker, outputIndex, brief: prefix ? `Continue ONLY the unfinished response below, without repeating it.\n${prefix}` : output.brief },
          (delta) => { fresh(); emit('writer.delta', { speaker: output.speaker, outputIndex, delta }); },
          (name, args) => emit('tool.called', { phase: 'writer', outputIndex, name, args }));
        fresh();
        this.repository.database.sqlite.transaction(() => {
          const message = this.repository.createMessage({ conversationId: turn.conversationId, parentId: parent, storyTurnId: turn.storyTurnId,
            role: 'assistant', authorKind: output.speaker.kind, speaker: output.speaker, content: prefix + result.text,
            providerState: prefix ? null : result.providerState, legacyPayload: null });
          parent = expectedHead = message.id; this.repository.setHead(turn.conversationId, message.id);
          emit('message.completed', { message: { ...message, providerState: null }, outputIndex, usage: result.usage });
        })(); wrote = true;
      }
      fresh();
      this.repository.database.sqlite.transaction(() => {
        this.repository.createProposals(turn.conversationId, plan);
        if (plan.protagonistStateProposals.length || plan.worldEventProposals.length) emit('proposals.ready', { plan });
        emit('story.settled', { head: expectedHead, variant: input.trigger === 'continue' || swipe });
      })();
      if (input.trigger !== 'continue' && !swipe) {
        try { await this.postprocess(turn.conversationId, signal); } catch { emit('postprocess.failed', { error: 'Memory/state update failed; the same turns remain eligible.' }); }
        await this.plugins?.settled(turn.conversationId);
      }
      fresh(); this.repository.updateTurn(turn.id, { status: 'completed', completedAt: new Date().toISOString() });
      emit('turn.completed');
    } catch (error) {
      if (!wrote && input.trigger !== 'normal' && this.repository.getConversation(turn.conversationId)?.headMessageId === expectedHead) this.repository.setHead(turn.conversationId, oldHead);
      const message = signal.aborted ? null : this.repository.redactError(error);
      this.repository.updateTurn(turn.id, { status: signal.aborted ? 'cancelled' : 'failed', error: message, completedAt: new Date().toISOString() });
      emit(signal.aborted ? 'turn.cancelled' : 'turn.failed', { error: message });
    }
  }
}
