import { z } from 'zod';
import { applyStateOperations, blankState, stateColumns, type ProtagonistTables } from '@new-ai-chat/contracts';
import type { AgentRuntime, BaseAgentRequest } from '@new-ai-chat/agent-runtime';
import type { Repository } from '../db/repository.js';

const chronicle = z.object({ timeSpan: z.string(), location: z.string(), chronicle: z.string().min(1), dialogue: z.array(z.string()).max(3), overview: z.string().max(40) }).strict();
export function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
}
export function settledStoryIds(repository: Repository, chat: string): string[] {
  const branch = repository.getActiveBranch(chat);
  const ids = new Set(branch.map((message) => message.id));
  return [...new Set(repository.events(chat).filter((event) => event.type === 'story.settled' && ids.has((event.payload as { head: string }).head)).map((event) => (event.payload as { storyTurnId: string }).storyTurnId))];
}
export class RecordService {
  private pending = new Set<string>();
  constructor(readonly repository: Repository, readonly runtime: AgentRuntime,
    private request: (chat: string, turn: string, signal: AbortSignal) => Promise<BaseAgentRequest>) {}
  async automatic(chat: string, signal: AbortSignal, trace?: BaseAgentRequest['trace']) {
    const config = this.repository.getGeneralSettings();
    const completed = settledStoryIds(this.repository, chat);
    const memory = this.repository.listMemories(chat, 1)[0];
    const state = this.repository.latestState(chat);
    const since = (marker: string | null | undefined) => marker ? completed.length - (completed.indexOf(marker) + 1) : completed.length;
    if (config.memoryTurnInterval > 0 && since(memory?.storyTurnId) >= config.memoryTurnInterval) await this.generate(chat, 'memory', signal, trace);
    if (config.stateTurnInterval > 0 && since(state?.storyTurnId) >= config.stateTurnInterval) await this.generate(chat, 'state', signal, trace);
  }
  async generate(chat: string, kind: 'memory' | 'state', signal: AbortSignal, trace?: BaseAgentRequest['trace']) {
    if (this.pending.has(chat)) throw new Error('A record update is already running.');
    this.pending.add(chat);
    try {
      const head = this.repository.getConversation(chat)?.headMessageId;
      const beforeState = this.repository.latestState(chat);
      const beforeMemory = this.repository.listMemories(chat, 1)[0];
      const storyTurnId = settledStoryIds(this.repository, chat).at(-1) ?? null;
      const request = await this.request(chat, storyTurnId ?? 'manual', AbortSignal.any([signal, AbortSignal.timeout(120_000)]));
      if (trace) request.trace = trace;
      const instruction = kind === 'memory'
        ? 'Return only a JSON object with timeSpan, location, chronicle (objective chronology, target 400 Chinese characters), dialogue (up to 3 strings), overview (at most 40 characters). Append a new stage, preserve earlier memory, and avoid repeating details already summarized. No AM codes. Do not invent events.'
        : `Return only a JSON array of state operations: {op: updateRow|insertRow|deleteRow, table, rowId? (updates/deletes only), cells?}. Never use SQL. Fields: ${JSON.stringify(stateColumns)}. global_state/protagonist_info/options are update-only row 1. Do not delete important_characters. Maintain current facts and compact long-term conclusions; chronology belongs in Memory. Required insert identities: name+gender_age, skill_name+skill_type, item_name+quantity+category, quest_name+quest_type. Inventory quantity is a positive integer; is_absent is 是 or 否. Empty array if no evidenced change.`;
      const answer = parseModelJson(await this.runtime.maintain(request, instruction));
      signal.throwIfAborted();
      if (this.repository.getConversation(chat)?.headMessageId !== head || this.repository.latestState(chat)?.id !== beforeState?.id || this.repository.listMemories(chat, 1)[0]?.id !== beforeMemory?.id) throw new Error('Records changed; discarded stale update.');
      return this.repository.database.sqlite.transaction(() => {
        if (kind === 'memory') {
          const record = chronicle.parse(answer);
          return this.repository.createMemory({ conversationId: chat, stage: (beforeMemory?.stage ?? 0) + 1, storyTurnId, source: 'generated', content: JSON.stringify(record, null, 2) });
        }
        const result = applyStateOperations(beforeState?.tables ?? blankState(), answer);
        return result.changed ? this.repository.createState(chat, storyTurnId, result.tables) : { unchanged: true };
      })();
    } finally { this.pending.delete(chat); }
  }
}

interface Checkpoint { before: ProtagonistTables; afterId: string | null; worldEventId: number | null; head: string | null }
export function applyProposal(repository: Repository, id: string, action: 'apply' | 'reject' | 'undo') {
  const proposal = repository.getProposal(id);
  if (!proposal) throw new Error('Proposal not found.');
  const chat = repository.getConversation(proposal.conversationId)!;
  if (action === 'reject') {
    if (proposal.status !== 'pending') throw new Error('Only pending proposals can be rejected.');
    repository.updateProposal(id, 'rejected'); return { status: 'rejected' };
  }
  return repository.database.sqlite.transaction(() => {
    const current = repository.latestState(chat.id);
    if (action === 'apply') {
      if (proposal.status !== 'pending') throw new Error('Proposal already handled.');
      if (!proposal.originHead || !repository.getActiveBranch(chat.id).some(m => m.id === proposal.originHead)) throw new Error('Proposal belongs to an obsolete branch or has no bound source node. Replan before applying.');
      if (!repository.getActiveBranch(chat.id).some((m) => m.storyTurnId === proposal.storyTurnId)) throw new Error('Proposal belongs to another branch.');
      const checkpoint: Checkpoint = { before: current?.tables ?? blankState(), afterId: null, worldEventId: null, head: chat.headMessageId };
      if (proposal.kind === 'state') {
        const result = applyStateOperations(checkpoint.before, Array.isArray(proposal.payload) ? proposal.payload : [proposal.payload]);
        if (result.changed) checkpoint.afterId = repository.createState(chat.id, proposal.storyTurnId, result.tables).id;
      } else {
        const event = z.object({ summary: z.string().min(1).max(5000), evidence: z.string().min(1).max(5000) }).parse(proposal.payload);
        checkpoint.worldEventId = repository.addEvent(chat.id, null, 'world.applied', { proposalId: id, head: chat.headMessageId, ...event }).id;
      }
      repository.updateProposal(id, 'applied', checkpoint); return { status: 'applied' };
    }
    if (proposal.status !== 'applied') throw new Error('Only applied proposals can be undone.');
    const checkpoint = proposal.committedSnapshot as Checkpoint;
    if (chat.headMessageId !== checkpoint.head || (checkpoint.afterId && current?.id !== checkpoint.afterId)) throw new Error('State or branch changed after application; refusing destructive undo.');
    if (checkpoint.worldEventId && repository.events(chat.id).filter((e) => e.type === 'world.applied' || e.type === 'world.undone').at(-1)?.id !== checkpoint.worldEventId) throw new Error('World changed after application.');
    if (checkpoint.afterId) repository.createState(chat.id, proposal.storyTurnId, checkpoint.before);
    if (checkpoint.worldEventId) repository.addEvent(chat.id, null, 'world.undone', { proposalId: id, head: chat.headMessageId });
    repository.updateProposal(id, 'undone', checkpoint); return { status: 'undone' };
  })();
}
