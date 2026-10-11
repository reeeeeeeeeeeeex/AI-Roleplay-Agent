import { randomUUID } from 'node:crypto';
import { AppError, type MemoryRebuildDraft, type MemoryRebuildOptions, type MemoryRebuildPlan, type MemoryRebuildRound, type MessageNode } from '@new-ai-chat/contracts';
import { assertRecordBudget, type AgentRuntime } from '@new-ai-chat/agent-runtime';
import type { Repository } from '../db/repository.js';
import type { TurnService } from './turns.js';
import { chronicle, parseModelJson, type RecordService } from './records.js';

// Reliable contiguous turns retain all outputs. Only unmarked/inconsistent legacy
// spans use the user-confirmed fallback; no message or settlement is rewritten.
export function rebuildRounds(messages: MessageNode[], settled: Set<string>): MemoryRebuildRound[] {
  const history = messages.filter(message => message.role !== 'system');
  const spans = new Map<string, number[]>();
  history.forEach((message, index) => {
    if (!message.storyTurnId) return;
    const positions = spans.get(message.storyTurnId) ?? [];
    positions.push(index); spans.set(message.storyTurnId, positions);
  });
  const rounds: MemoryRebuildRound[] = [];
  let pending: string[] = [];
  for (let index = 0; index < history.length;) {
    const message = history[index]!;
    const positions = message.storyTurnId ? spans.get(message.storyTurnId)! : [];
    const end = positions.at(-1) ?? index;
    const span = history.slice(index, end + 1);
    const firstAssistant = span.findIndex(item => item.role === 'assistant');
    const reliable = message.storyTurnId && settled.has(message.storyTurnId) && positions[0] === index
      && end - index + 1 === positions.length && firstAssistant >= 0
      && span.slice(firstAssistant).every(item => item.role === 'assistant');
    if (reliable && !pending.length) {
      rounds.push({ messageIds: span.map(item => item.id), storyTurnId: message.storyTurnId, inferred: false });
      index = end + 1;
    } else {
      pending.push(message.id);
      if (message.role === 'assistant') {
        rounds.push({ messageIds: pending, storyTurnId: null, inferred: true }); pending = [];
      }
      index++;
    }
  }
  return rounds;
}

export class MemoryRebuildService {
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  constructor(private repo: Repository, private runtime: AgentRuntime, private turns: TurnService, private records: RecordService) {}

  private version(chat: string): string {
    return JSON.stringify([this.repo.listMemories(chat, 1)[0]?.id ?? null, this.repo.events(chat, ['memory.edited']).at(-1)?.id ?? null]);
  }
  private valid(draft: MemoryRebuildDraft): boolean {
    if (this.repo.getConversation(draft.conversationId)?.headMessageId !== draft.head || this.version(draft.conversationId) !== draft.memoryVersion) return false;
    const ids = this.repo.activeMessageIds(draft.conversationId);
    return draft.plan.rounds.every(round => round.messageIds.every(id => ids.has(id)));
  }
  private require(chat: string, id: string): MemoryRebuildDraft {
    const draft = this.repo.getMemoryRebuild(chat);
    if (!draft || draft.id !== id) throw new AppError('memoryRebuild.missing');
    return draft;
  }
  get(chat: string): MemoryRebuildDraft | null {
    let draft = this.repo.getMemoryRebuild(chat);
    if (!draft) return null;
    if (!this.valid(draft) && draft.status !== 'stale') {
      this.active.get(chat)?.controller.abort();
      const error = new AppError('memoryRebuild.stale');
      draft = { ...draft, status: 'stale', error: error.message, errorText: error.uiText };
      this.repo.saveMemoryRebuild(draft);
    }
    return draft;
  }
  plan(chat: string, options?: MemoryRebuildOptions): MemoryRebuildPlan | null {
    if (!this.repo.getConversation(chat)) throw new AppError('Conversation not found.');
    const branch = this.repo.getActiveBranch(chat);
    const activeIds = new Set(branch.map(message => message.id));
    const settlements = new Map<string, number>();
    for (const event of this.repo.events(chat, ['story.settled'])) {
      const value = event.payload as { head: string; storyTurnId: string };
      if (activeIds.has(value.head)) settlements.set(value.storyTurnId, (settlements.get(value.storyTurnId) ?? 0) + 1);
    }
    // Some legacy imports reused one ID across several replies/settlements.
    // Those are not reliable multi-output turns; use the agreed fallback.
    const all = rebuildRounds(branch, new Set([...settlements].filter(([, count]) => count === 1).map(([id]) => id)));
    if (!all.length) { if (options) throw new AppError('memoryRebuild.empty'); return null; }
    options ??= { rounds: Math.min(100, all.length), groups: 1, batchRounds: 10 };
    if (![options.rounds, options.groups, options.batchRounds].every(value => Number.isSafeInteger(value) && value > 0)
      || options.rounds > all.length || options.groups > options.rounds) throw new AppError('memoryRebuild.range', all.length);
    const rounds = all.slice(-options.rounds);
    const groups: MemoryRebuildPlan['groups'] = [], batches: MemoryRebuildPlan['batches'] = [];
    let from = 1;
    for (let group = 1; group <= options.groups; group++) {
      const size = Math.floor(rounds.length / options.groups) + (group <= rounds.length % options.groups ? 1 : 0);
      const to = from + size - 1;
      groups.push({ from, to });
      for (let next = from; next <= to; next += options.batchRounds) batches.push({ group, from, to: Math.min(next + options.batchRounds - 1, to), newFrom: next });
      from = to + 1;
    }
    const startId = rounds[0]!.messageIds[0]!, endId = rounds.at(-1)!.messageIds.at(-1)!;
    const connection = this.repo.resolveConnection(this.repo.getGeneralSettings().recordConnectionId);
    return { options, availableRounds: all.length, rounds, batches, groups,
      start: { id: startId, text: this.repo.getMessage(startId)!.content.slice(0, 120) },
      end: { id: endId, text: this.repo.getMessage(endId)!.content.slice(0, 120) }, model: connection?.model ?? null };
  }
  start(chat: string, head: string | null, options: MemoryRebuildOptions): MemoryRebuildDraft {
    this.turns.assertIdle(chat);
    if (this.records.busy(chat)) throw new AppError('A record update is already running.');
    if (this.repo.getMemoryRebuild(chat)) throw new AppError('memoryRebuild.exists');
    if (this.repo.getConversation(chat)?.headMessageId !== head) throw new AppError('memoryRebuild.stale');
    const plan = this.plan(chat, options)!;
    if (!plan.model) throw new AppError('record.connectionMissing');
    const stamp = new Date().toISOString();
    const draft: MemoryRebuildDraft = { id: randomUUID(), conversationId: chat, head, memoryVersion: this.version(chat), plan, stages: [], status: 'paused', error: null, createdAt: stamp, updatedAt: stamp };
    this.repo.saveMemoryRebuild(draft);
    return this.resume(chat, draft.id);
  }
  resume(chat: string, id: string): MemoryRebuildDraft {
    this.turns.assertIdle(chat);
    if (this.records.busy(chat)) throw new AppError('A record update is already running.');
    if (this.active.has(chat)) throw new AppError('memoryRebuild.running');
    const draft = this.require(chat, id);
    if (draft.status === 'stale' || !this.valid(draft)) { this.get(chat); throw new AppError('memoryRebuild.stale'); }
    if (draft.status === 'ready') return draft;
    const connection = this.repo.resolveConnection(this.repo.getGeneralSettings().recordConnectionId);
    if (!connection) throw new AppError('record.connectionMissing');
    const running = { ...draft, plan: { ...draft.plan, model: connection.model }, status: 'running' as const, error: null, errorText: undefined };
    this.repo.saveMemoryRebuild(running);
    const controller = new AbortController();
    const task = { controller, done: Promise.resolve() };
    this.active.set(chat, task);
    task.done = Promise.resolve().then(() => this.run(running, controller.signal)).finally(() => this.active.delete(chat));
    return running;
  }
  private async run(draft: MemoryRebuildDraft, signal: AbortSignal): Promise<void> {
    const chat = draft.conversationId;
    try {
      const base = await this.turns.request(chat, draft.id, signal, true, undefined, 'memory-rebuild');
      const messages = new Map(this.repo.getActiveBranch(chat).map(message => [message.id, message]));
      for (let index = draft.stages.length; index < draft.plan.batches.length; index++) {
        signal.throwIfAborted();
        this.require(chat, draft.id);
        if (!this.valid(draft)) throw new AppError('memoryRebuild.stale');
        const batch = draft.plan.batches[index]!;
        const history = draft.plan.rounds.slice(batch.from - 1, batch.to).flatMap(round => round.messageIds.map(id => messages.get(id)!));
        const added = draft.plan.rounds.slice(batch.newFrom - 1, batch.to);
        const addedIds = added.flatMap(round => round.messageIds);
        const offset = history.findIndex(message => message.id === addedIds[0]);
        const instruction = `Return only a JSON object with timeSpan, location, chronicle (objective chronology, target 400 Chinese characters), dialogue (up to 3 strings), overview (at most 40 characters). Rebuild stage ${index + 1}. The history array contains context for this group; summarize ONLY the newly covered messages at array indexes ${offset} through ${history.length - 1} (zero-based), rounds ${batch.newFrom}–${batch.to}. Earlier messages and all previous stages are context only; do not repeat or rewrite their summaries. Background, identities and pinned facts are not evidence that an event happened. Preserve the language of the story. Do not invent events. No AM codes.`;
        const request = { ...base, recordRebuild: true, history, fixedHistory: true, latestUserText: '',
          signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
          dynamicContext: [...base.dynamicContext.filter(item => item.required), ...draft.stages.map((stage, i) => ({ source: 'memory' as const, title: `Stage ${i + 1}`, content: stage.content, priority: 100 + i / 1_000_000 }))] };
        assertRecordBudget(request, instruction);
        const answer = await this.runtime.maintain(request, instruction);
        request.signal.throwIfAborted();
        let content: string;
        try { content = JSON.stringify(chronicle.parse(parseModelJson(answer)), null, 2); }
        catch { throw new AppError('memoryRebuild.format'); }
        this.repo.database.sqlite.transaction(() => {
          this.require(chat, draft.id);
          if (!this.valid(draft)) throw new AppError('memoryRebuild.stale');
          const stage = { content, storyTurnId: added.at(-1)!.storyTurnId,
            coverage: { startMessageId: addedIds[0]!, endMessageId: addedIds.at(-1)!, storyTurnIds: added.flatMap(round => round.storyTurnId ? [round.storyTurnId] : []), roundCount: added.length, inferred: added.some(round => round.inferred) } };
          draft = { ...draft, stages: [...draft.stages, stage], status: index + 1 === draft.plan.batches.length ? 'ready' : 'running', updatedAt: new Date().toISOString() };
          this.repo.saveMemoryRebuild(draft);
        })();
      }
    } catch (error) {
      if (this.repo.getMemoryRebuild(chat)?.id !== draft.id) return;
      const stale = !this.valid(draft);
      const failure = stale ? new AppError('memoryRebuild.stale') : error;
      const paused = signal.aborted || (failure instanceof AppError && failure.uiText.key === 'memoryRebuild.budget');
      this.repo.saveMemoryRebuild({ ...draft, status: stale ? 'stale' : paused ? 'paused' : 'failed',
        error: signal.aborted && !stale ? null : this.repo.redactError(failure), errorText: signal.aborted && !stale ? undefined : this.repo.describeError(failure), updatedAt: new Date().toISOString() });
    }
  }
  async stop(chat: string, id: string) {
    this.require(chat, id);
    const task = this.active.get(chat); task?.controller.abort(); await task?.done;
    return this.get(chat);
  }
  async discard(chat: string, id: string) {
    await this.stop(chat, id); this.repo.deleteMemoryRebuild(chat); return { deleted: true };
  }
  apply(chat: string, id: string) {
    this.turns.assertIdle(chat);
    if (this.active.has(chat) || this.records.busy(chat)) throw new AppError('memoryRebuild.running');
    return this.repo.database.sqlite.transaction(() => {
      const draft = this.require(chat, id);
      if (draft.status === 'stale' || !this.valid(draft)) throw new AppError('memoryRebuild.stale');
      if (draft.status !== 'ready' || draft.stages.length !== draft.plan.batches.length) throw new AppError('memoryRebuild.incomplete');
      draft.stages.forEach((stage, index) => this.repo.createMemory({ ...stage, conversationId: chat, stage: index + 1, source: index === 0 ? 'rebuilt' : 'generated' }));
      this.repo.deleteMemoryRebuild(chat);
      return this.repo.listMemoryStages(chat);
    })();
  }
  async idle(chat: string) { await this.active.get(chat)?.done; }
  async shutdown() {
    for (const task of this.active.values()) task.controller.abort();
    await Promise.all([...this.active.values()].map(task => task.done));
  }
}
