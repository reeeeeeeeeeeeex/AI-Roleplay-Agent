import type { RetrievedContext, StoryContextSource, RuntimeCharacter } from '@new-ai-chat/agent-runtime';
import type { MessageNode } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';

// Tools read this immutable request snapshot, never a newly selected chat or branch.
export class StoryContext implements StoryContextSource {
  readonly history: MessageNode[];
  readonly cast: RuntimeCharacter[];
  readonly state;
  readonly memory: RetrievedContext[];
  readonly lore;
  constructor(repository: Repository, conversationId: string) {
    const chat = repository.getConversation(conversationId)!;
    const history = repository.getActiveBranch(conversationId).filter((m) => m.role !== 'system');
    const ceiling = repository.resolveConnection()?.historyMessageLimit ?? 0;
    this.history = ceiling > 0 ? history.slice(-ceiling) : history;
    const group = chat.groupId ? repository.getGroup(chat.groupId) : null;
    this.cast = repository.getCharactersByIds(group?.memberIds ?? (chat.characterId ? [chat.characterId] : []))
      .map(({ id, name, description, personality, scenario, exampleDialogue, systemPrompt, postHistoryInstructions }) => ({ id, name, description, personality, scenario: group || chat.scenario ? '' : scenario, exampleDialogue, systemPrompt, postHistoryInstructions }));
    this.state = repository.latestState(conversationId);
    const memories = repository.listMemories(conversationId, 1000);
    // Imported ST summaries are cumulative snapshots, not separate chronology stages.
    // A manual replacement (including an empty string) is an explicit new baseline.
    const baseline = memories.findIndex((m) => m.source === 'imported' || m.source === 'manual');
    this.memory = (baseline < 0 ? memories : memories.slice(0, baseline + 1)).reverse().filter((m) => m.content.trim()).map((m) => ({ source: 'memory', title: `Stage ${m.stage}`, content: m.content, priority: m.stage }));
    this.lore = chat.lorebookIds.flatMap((id) => { const book = repository.getLorebook(id); return book?.entries.filter((e) => e.enabled).map((e) => ({ ...e, title: book.name })) ?? []; });
    const scenario = chat.scenario || group?.scenario;
    if (scenario) this.lore.unshift({ id: 'chat-scenario', lorebookId: '', keys: [], secondaryKeys: [], enabled: true, constant: true, order: 0, position: 'before', depth: 0, content: scenario, title: group ? 'Group Scenario' : 'Scenario', legacyPayload: null });
    this.world = repository.currentWorld(conversationId);
  }
  readonly world;
  async readRecentStory(limit: number): Promise<MessageNode[]> {
    return this.history.slice(-limit).map((node) => ({ ...node, providerState: null, legacyPayload: null }));
  }
  async searchLore(query: string, limit: number): Promise<RetrievedContext[]> {
    const haystack = query.normalize('NFKC').toLowerCase();
    return this.lore.filter((e) => !e.constant && e.keys.some((key) => key && haystack.includes(key.normalize('NFKC').toLowerCase())) && (!e.secondaryKeys.length || e.secondaryKeys.some((key) => key && haystack.includes(key.toLowerCase()))))
      .sort((a, b) => a.order - b.order).slice(0, limit).map((e) => ({ source: 'lore', title: e.title, content: e.content, priority: 1000 - e.order }));
  }
  async readMemory(limit: number) { return this.memory.slice(-limit); }
  async readState() { return this.state; }
  async readCast() { return this.cast; }
  stableLore(): RetrievedContext[] { return this.lore.filter((e) => e.constant).sort((a, b) => a.order - b.order).map((e) => ({ source: 'lore', title: e.title, content: e.content, priority: 1000 - e.order })); }
  async dynamic(query: string): Promise<RetrievedContext[]> {
    return [...await this.searchLore(query, 12), ...this.memory, ...(this.world.length ? [{ source: 'lore' as const, title: 'Applied world facts', content: JSON.stringify(this.world), priority: 1100 }] : []), ...(this.state ? [{ source: 'state' as const, title: 'Current state', content: JSON.stringify(this.state.tables), priority: 500 }] : [])];
  }
}
