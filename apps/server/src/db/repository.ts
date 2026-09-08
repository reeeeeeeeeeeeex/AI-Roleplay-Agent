import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { defaultPromptSettings, generalSettingsSchema, promptSettingsSchema, type GeneralSettings, type PromptSettings, type TurnTrace } from '@new-ai-chat/contracts';
import type {
  Character,
  CharacterInput,
  ConnectionInput,
  ConnectionSummary,
  Conversation,
  Group,
  Lorebook,
  MemoryEntry,
  MessageNode,
  Persona,
  ProtagonistStateSnapshot,
  ProtagonistTables,
  SessionEvent,
  TurnPlan,
  TurnRecord,
} from '@new-ai-chat/contracts';
import type { RuntimeConnection } from '@new-ai-chat/agent-runtime';
import type { AppDatabase } from './database.js';
import {
  characters,
  connections,
  conversations,
  groups,
  imports,
  lorebooks,
  loreEntries,
  memories,
  messages,
  personas,
  proposals,
  sessionEvents,
  stateSnapshots,
  turns,
  appSettings,
  turnTraces,
} from './schema.js';

const now = () => new Date().toISOString();
const id = () => randomUUID();

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type TurnRow = typeof turns.$inferSelect;

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as Conversation['kind'],
    characterId: row.characterId,
    groupId: row.groupId,
    personaId: row.personaId,
    lorebookIds: row.lorebookIds,
    headMessageId: row.headMessageId,
    scenario: row.scenario,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessage(row: MessageRow): MessageNode {
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentId: row.parentId,
    storyTurnId: row.storyTurnId,
    role: row.role as MessageNode['role'],
    authorKind: row.authorKind as MessageNode['authorKind'],
    speaker: row.speaker,
    content: row.content,
    providerState: row.providerState,
    legacyPayload: row.legacyPayload,
    createdAt: row.createdAt,
  };
}

function mapTurn(row: TurnRow): TurnRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    storyTurnId: row.storyTurnId,
    status: row.status as TurnRecord['status'],
    trigger: row.trigger as TurnRecord['trigger'],
    plan: row.plan,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export class Repository {
  constructor(readonly database: AppDatabase) {
    database.sqlite.transaction(() => {
      const settings = database.db.select().from(appSettings).all();
      if (settings.some(row => row.key === 'general')) return;
      const previous = settings.find(row => row.key === 'defaultConnection')?.value;
      this.setGeneralSettings(generalSettingsSchema.parse({
        connectionId: typeof previous === 'string' && this.getRuntimeConnection(previous) ? previous : null,
        narrator: settings.find(row => row.key === 'narrator')?.value,
      }));
      database.db.delete(appSettings).where(inArray(appSettings.key, ['defaultConnection', 'narrator'])).run();
    })();
  }
  getGeneralSettings(): GeneralSettings {
    const row = this.database.db.select().from(appSettings).where(eq(appSettings.key, 'general')).get();
    return generalSettingsSchema.parse(row?.value ?? {});
  }
  setGeneralSettings(value: GeneralSettings): GeneralSettings {
    const settings = generalSettingsSchema.parse(value);
    if (settings.connectionId && !this.getRuntimeConnection(settings.connectionId)) throw new Error('Connection not found.');
    this.database.db.insert(appSettings).values({ key: 'general', value: settings })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: settings } }).run();
    return settings;
  }

  getPromptSettings(): PromptSettings {
    const row = this.database.db.select().from(appSettings).where(eq(appSettings.key, 'prompts')).get();
    return promptSettingsSchema.parse(row?.value ?? defaultPromptSettings);
  }
  setPromptSettings(value: PromptSettings): PromptSettings {
    const prompts = promptSettingsSchema.parse(value);
    this.database.db.insert(appSettings).values({ key: 'prompts', value: prompts })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: prompts } }).run();
    return prompts;
  }
  resolveConnection(): RuntimeConnection | null {
    const selected = this.getGeneralSettings().connectionId;
    return selected ? this.getRuntimeConnection(selected) : null;
  }

  listConnections(): ConnectionSummary[] {
    return this.database.db.select().from(connections).orderBy(asc(connections.name)).all().map((row) => ({
      id: row.id, name: row.name, protocol: row.protocol as ConnectionSummary['protocol'], baseUrl: row.baseUrl,
      model: row.model, hasApiKey: row.apiKey.length > 0, headers: Object.fromEntries(Object.keys(row.headers).map((key) => [key, '[stored]'])),
      temperature: row.temperature / 1000, maxTokens: row.maxTokens, contextWindow: row.contextWindow, historyMessageLimit: row.historyMessageLimit,
      reasoning: row.reasoning as ConnectionSummary['reasoning'], createdAt: row.createdAt, updatedAt: row.updatedAt,
    }));
  }

  getRuntimeConnection(connectionId: string): RuntimeConnection | null {
    const row = this.database.db.select().from(connections).where(eq(connections.id, connectionId)).get();
    return row ? {
      id: row.id, protocol: row.protocol as RuntimeConnection['protocol'], baseUrl: row.baseUrl, model: row.model,
      apiKey: row.apiKey, headers: row.headers, temperature: row.temperature / 1000,
      maxTokens: row.maxTokens, contextWindow: row.contextWindow, historyMessageLimit: row.historyMessageLimit, reasoning: row.reasoning as RuntimeConnection['reasoning'],
    } : null;
  }

  createConnection(input: ConnectionInput): ConnectionSummary {
    const timestamp = now();
    const row = { id: id(), ...input, apiKey: input.apiKey ?? '', temperature: Math.round(input.temperature * 1000), createdAt: timestamp, updatedAt: timestamp };
    this.database.db.insert(connections).values(row).run();
    return this.listConnections().find((item) => item.id === row.id)!;
  }

  updateConnection(connectionId: string, input: ConnectionInput): ConnectionSummary | null {
    const existing = this.getRuntimeConnection(connectionId);
    if (!existing) return null;
    this.database.db.update(connections).set({
      name: input.name, protocol: input.protocol, baseUrl: input.baseUrl, model: input.model,
      apiKey: input.apiKey ?? existing.apiKey, headers: Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [key, value === '[stored]' ? existing.headers[key] ?? '' : value])),
      temperature: Math.round(input.temperature * 1000), maxTokens: input.maxTokens, contextWindow: input.contextWindow, historyMessageLimit: input.historyMessageLimit,
      reasoning: input.reasoning, updatedAt: now(),
    }).where(eq(connections.id, connectionId)).run();
    return this.listConnections().find((item) => item.id === connectionId) ?? null;
  }

  deleteConnection(connectionId: string): boolean {
    return this.database.sqlite.transaction(() => {
      const settings = this.getGeneralSettings();
      if (settings.connectionId === connectionId) this.setGeneralSettings({ ...settings, connectionId: null });
      return this.database.db.delete(connections).where(eq(connections.id, connectionId)).run().changes > 0;
    })();
  }

  listCharacters(): Character[] {
    return this.database.db.select().from(characters).orderBy(asc(characters.name)).all() as Character[];
  }
  getCharacter(characterId: string): Character | null {
    return this.database.db.select().from(characters).where(eq(characters.id, characterId)).get() as Character | undefined ?? null;
  }
  createCharacter(input: CharacterInput): Character {
    const timestamp = now(); const row = { id: id(), ...input, createdAt: timestamp, updatedAt: timestamp };
    this.database.db.insert(characters).values(row).run(); return this.getCharacter(row.id)!;
  }
  updateCharacter(characterId: string, input: CharacterInput): Character | null {
    if (!this.getCharacter(characterId)) return null;
    this.database.db.update(characters).set({ ...input, updatedAt: now() }).where(eq(characters.id, characterId)).run();
    return this.getCharacter(characterId);
  }
  deleteCharacter(characterId: string): boolean {
    return this.database.db.delete(characters).where(eq(characters.id, characterId)).run().changes > 0;
  }

  listPersonas(): Persona[] { return this.database.db.select().from(personas).orderBy(asc(personas.name)).all() as Persona[]; }
  getPersona(personaId: string): Persona | null { return this.database.db.select().from(personas).where(eq(personas.id, personaId)).get() as Persona | undefined ?? null; }
  createPersona(input: { name: string; description: string; avatarPath: string | null; legacyPayload?: unknown }): Persona {
    const timestamp = now(); const row = { id: id(), ...input, createdAt: timestamp, updatedAt: timestamp };
    this.database.db.insert(personas).values(row).run(); return this.getPersona(row.id)!;
  }
  updatePersona(personaId: string, input: { name: string; description: string; avatarPath: string | null; legacyPayload?: unknown }): Persona | null {
    if (!this.getPersona(personaId)) return null;
    this.database.db.update(personas).set({ ...input, updatedAt: now() }).where(eq(personas.id, personaId)).run(); return this.getPersona(personaId);
  }
  deletePersona(personaId: string): boolean { return this.database.db.delete(personas).where(eq(personas.id, personaId)).run().changes > 0; }

  listGroups(): Group[] { return this.database.db.select().from(groups).orderBy(asc(groups.name)).all() as Group[]; }
  getGroup(groupId: string): Group | null { return this.database.db.select().from(groups).where(eq(groups.id, groupId)).get() as Group | undefined ?? null; }
  createGroup(input: { name: string; memberIds: string[]; scenario: string }, legacyPayload: unknown = null): Group {
    const timestamp = now(); const row = { id: id(), ...input, legacyPayload, createdAt: timestamp, updatedAt: timestamp };
    this.database.db.insert(groups).values(row).run(); return this.getGroup(row.id)!;
  }
  updateGroup(groupId: string, input: { name: string; memberIds: string[]; scenario: string }): Group | null {
    if (!this.getGroup(groupId)) return null;
    this.database.db.update(groups).set({ ...input, updatedAt: now() }).where(eq(groups.id, groupId)).run(); return this.getGroup(groupId);
  }
  deleteGroup(groupId: string): boolean { return this.database.db.delete(groups).where(eq(groups.id, groupId)).run().changes > 0; }

  listLorebooks(): Lorebook[] {
    return this.database.db.select().from(lorebooks).orderBy(asc(lorebooks.name)).all().map((book) => this.getLorebook(book.id)!);
  }
  getLorebook(lorebookId: string): Lorebook | null {
    const book = this.database.db.select().from(lorebooks).where(eq(lorebooks.id, lorebookId)).get();
    if (!book) return null;
    const entries = this.database.db.select().from(loreEntries).where(eq(loreEntries.lorebookId, lorebookId)).orderBy(asc(loreEntries.order)).all();
    return { ...book, entries: entries.map((entry) => ({ ...entry, position: entry.position as 'before' | 'after' | 'depth' })) };
  }
  createLorebook(input: { name: string; description: string; legacyPayload?: unknown; entries: Array<Omit<typeof loreEntries.$inferInsert, 'id' | 'lorebookId'>> }): Lorebook {
    const timestamp = now(); const bookId = id();
    const transaction = this.database.sqlite.transaction(() => {
      this.database.db.insert(lorebooks).values({ id: bookId, name: input.name, description: input.description, legacyPayload: input.legacyPayload ?? null, createdAt: timestamp, updatedAt: timestamp }).run();
      for (const entry of input.entries) this.database.db.insert(loreEntries).values({ ...entry, id: id(), lorebookId: bookId }).run();
    });
    transaction(); return this.getLorebook(bookId)!;
  }
  updateLorebook(lorebookId: string, input: { name: string; description: string; legacyPayload?: unknown; entries: Array<Omit<typeof loreEntries.$inferInsert, 'id' | 'lorebookId'>> }): Lorebook | null {
    if (!this.getLorebook(lorebookId)) return null;
    const transaction = this.database.sqlite.transaction(() => {
      this.database.db.update(lorebooks).set({ name: input.name, description: input.description, legacyPayload: input.legacyPayload, updatedAt: now() }).where(eq(lorebooks.id, lorebookId)).run();
      this.database.db.delete(loreEntries).where(eq(loreEntries.lorebookId, lorebookId)).run();
      for (const entry of input.entries) this.database.db.insert(loreEntries).values({ ...entry, id: id(), lorebookId }).run();
    });
    transaction(); return this.getLorebook(lorebookId);
  }
  deleteLorebook(lorebookId: string): boolean { return this.database.db.delete(lorebooks).where(eq(lorebooks.id, lorebookId)).run().changes > 0; }

  listConversations(): Conversation[] { return this.database.db.select().from(conversations).orderBy(desc(conversations.updatedAt)).all().map(mapConversation); }
  getConversation(conversationId: string): Conversation | null {
    const row = this.database.db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    return row ? mapConversation(row) : null;
  }
  createConversation(input: Omit<Conversation, 'id' | 'headMessageId' | 'createdAt' | 'updatedAt'>): Conversation {
    const timestamp = now(); const conversationId = id();
    this.database.db.insert(conversations).values({
      id: conversationId, title: input.title, kind: input.kind, characterId: input.characterId, groupId: input.groupId,
      personaId: input.personaId, lorebookIds: input.lorebookIds,
      scenario: input.scenario,
      createdAt: timestamp, updatedAt: timestamp,
    }).run();
    return this.getConversation(conversationId)!;
  }
  updateConversation(conversationId: string, input: Omit<Conversation, 'id' | 'headMessageId' | 'createdAt' | 'updatedAt'>): Conversation | null {
    if (!this.getConversation(conversationId)) return null;
    this.database.db.update(conversations).set({
      title: input.title, kind: input.kind, characterId: input.characterId, groupId: input.groupId,
      personaId: input.personaId, lorebookIds: input.lorebookIds, updatedAt: now(),
      scenario: input.scenario,
    }).where(eq(conversations.id, conversationId)).run();
    return this.getConversation(conversationId);
  }
  deleteConversation(conversationId: string): boolean { return this.database.db.delete(conversations).where(eq(conversations.id, conversationId)).run().changes > 0; }

  listMessages(conversationId: string): MessageNode[] {
    return this.database.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).all().map(mapMessage);
  }
  getMessage(messageId: string): MessageNode | null {
    const row = this.database.db.select().from(messages).where(eq(messages.id, messageId)).get(); return row ? mapMessage(row) : null;
  }
  getActiveBranch(conversationId: string): MessageNode[] {
    const conversation = this.getConversation(conversationId); if (!conversation?.headMessageId) return [];
    const all = new Map(this.listMessages(conversationId).map((message) => [message.id, message]));
    const branch: MessageNode[] = []; let current = all.get(conversation.headMessageId);
    const visited = new Set<string>();
    while (current) { if (visited.has(current.id)) throw new Error('Cycle in message branch.'); visited.add(current.id); branch.push(current); current = current.parentId ? all.get(current.parentId) : undefined; }
    return branch.reverse();
  }
  createMessage(input: Omit<MessageNode, 'id' | 'createdAt'>): MessageNode {
    const row = { ...input, id: id(), createdAt: now() };
    this.database.db.insert(messages).values(row).run(); return this.getMessage(row.id)!;
  }
  setHead(conversationId: string, messageId: string | null): void {
    if (messageId && this.getMessage(messageId)?.conversationId !== conversationId) throw new Error('Invalid branch head.');
    this.database.db.update(conversations).set({ headMessageId: messageId, updatedAt: now() }).where(eq(conversations.id, conversationId)).run();
  }
  listSwipes(messageId: string): MessageNode[] {
    const message = this.getMessage(messageId); if (!message) return [];
    const condition = message.parentId
      ? and(eq(messages.conversationId, message.conversationId), eq(messages.parentId, message.parentId))
      : and(eq(messages.conversationId, message.conversationId), isNull(messages.parentId));
    return this.database.db.select().from(messages).where(condition).orderBy(asc(messages.createdAt)).all().map(mapMessage);
  }

  createTurn(conversationId: string, storyTurnId: string, trigger: TurnRecord['trigger']): TurnRecord {
    const row = { id: id(), conversationId, storyTurnId, status: 'queued', trigger, plan: null, error: null, createdAt: now(), completedAt: null };
    this.database.db.insert(turns).values(row).run(); return this.getTurn(row.id)!;
  }
  getTurn(turnId: string): TurnRecord | null { const row = this.database.db.select().from(turns).where(eq(turns.id, turnId)).get(); return row ? mapTurn(row) : null; }
  updateTurn(turnId: string, values: { status?: TurnRecord['status']; plan?: TurnPlan | null; error?: string | null; completedAt?: string | null }): TurnRecord {
    this.database.db.update(turns).set(values).where(eq(turns.id, turnId)).run(); return this.getTurn(turnId)!;
  }

  addEvent(conversationId: string, turnId: string | null, type: string, payload: unknown): SessionEvent {
    const createdAt = now();
    const result = this.database.db.insert(sessionEvents).values({ conversationId, turnId, type, payload, createdAt }).run();
    return { id: Number(result.lastInsertRowid), conversationId, turnId, type, payload, createdAt };
  }
  eventsForTurn(turnId: string, afterId = 0): SessionEvent[] {
    return this.database.db.select().from(sessionEvents)
      .where(eq(sessionEvents.turnId, turnId))
      .orderBy(asc(sessionEvents.id)).all()
      .filter((event) => event.id > afterId) as SessionEvent[];
  }

  private traceSafe(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.traceSafe(item));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[-_]?key|authorization|cookie|secret|signature|encrypted|access[-_]?token|refresh[-_]?token/iu.test(key)) result[key] = '[redacted]';
      else result[key] = this.traceSafe(item);
    }
    return result;
  }
  createTrace(input: Omit<TurnTrace, 'id' | 'createdAt' | 'completedAt'>): TurnTrace {
    const row = {
      id: id(), conversationId: input.conversationId, turnId: input.turnId, phase: input.phase,
      requestIndex: input.requestIndex, status: input.status, model: input.model,
      request: this.traceSafe(input.request), response: this.traceSafe(input.response),
      tools: this.traceSafe(input.tools) as unknown[], thinking: input.thinking,
      usage: input.usage, error: input.error, createdAt: now(), completedAt: null,
    };
    this.database.db.insert(turnTraces).values(row).run();
    return row as TurnTrace;
  }
  updateTrace(traceId: string, values: Partial<Pick<TurnTrace, 'status' | 'request' | 'response' | 'tools' | 'thinking' | 'usage' | 'error' | 'completedAt'>>): TurnTrace | null {
    const patch = { ...values, request: values.request === undefined ? undefined : this.traceSafe(values.request), response: values.response === undefined ? undefined : this.traceSafe(values.response), tools: values.tools === undefined ? undefined : this.traceSafe(values.tools) as unknown[] };
    this.database.db.update(turnTraces).set(patch).where(eq(turnTraces.id, traceId)).run();
    const row = this.database.db.select().from(turnTraces).where(eq(turnTraces.id, traceId)).get();
    return row ? row as TurnTrace : null;
  }
  listTraces(turnId: string): TurnTrace[] {
    return this.database.db.select().from(turnTraces).where(eq(turnTraces.turnId, turnId)).orderBy(asc(turnTraces.requestIndex)).all() as TurnTrace[];
  }
  listConversationTraces(conversationId: string, limit = 20): TurnTrace[] {
    return this.database.db.select().from(turnTraces).where(eq(turnTraces.conversationId, conversationId)).orderBy(desc(turnTraces.createdAt)).limit(limit * 8).all() as TurnTrace[];
  }
  pruneTraces(conversationId: string, keepTurns = 20): void {
    const turnsWithTraces = this.database.db.select({ turnId: turnTraces.turnId }).from(turnTraces)
      .where(eq(turnTraces.conversationId, conversationId)).orderBy(desc(turnTraces.createdAt)).all();
    const ids = [...new Set(turnsWithTraces.map((row) => row.turnId))];
    const remove = ids.slice(keepTurns);
    if (!remove.length) return;
    this.database.sqlite.prepare(`DELETE FROM turn_traces WHERE conversation_id = ? AND turn_id IN (${remove.map(() => '?').join(',')})`).run(conversationId, ...remove);
  }

  listMemories(conversationId: string, limit = 20): MemoryEntry[] {
    const active = this.checkpointFilter(conversationId);
    return (this.database.db.select().from(memories).where(eq(memories.conversationId, conversationId)).orderBy(desc(sql`rowid`)).all() as MemoryEntry[]).filter((row) => active(row.id)).slice(0, limit);
  }
  createMemory(input: Omit<MemoryEntry, 'id' | 'createdAt'>): MemoryEntry {
    const row = { ...input, id: id(), createdAt: now() }; this.database.db.insert(memories).values(row).run();
    this.addEvent(input.conversationId, null, 'checkpoint', { id: row.id, head: this.getConversation(input.conversationId)?.headMessageId ?? null }); return row;
  }
  latestState(conversationId: string): ProtagonistStateSnapshot | null {
    const active = this.checkpointFilter(conversationId);
    const row = this.database.db.select().from(stateSnapshots).where(eq(stateSnapshots.conversationId, conversationId)).orderBy(desc(sql`rowid`)).all().find((item) => active(item.id));
    return row ? { ...row, version: 1 } : null;
  }
  createState(conversationId: string, storyTurnId: string | null, tables: ProtagonistTables): ProtagonistStateSnapshot {
    const row = { id: id(), conversationId, storyTurnId, version: 1 as const, tables, createdAt: now() };
    this.database.db.insert(stateSnapshots).values(row).run();
    this.addEvent(conversationId, null, 'checkpoint', { id: row.id, head: this.getConversation(conversationId)?.headMessageId ?? null }); return row;
  }
  listStateSnapshots(conversationId: string): ProtagonistStateSnapshot[] {
    const active = this.checkpointFilter(conversationId);
    return this.database.db.select().from(stateSnapshots).where(eq(stateSnapshots.conversationId, conversationId)).orderBy(desc(sql`rowid`)).all().filter((row) => active(row.id)).map((row) => ({ ...row, version: 1 }));
  }

  createProposals(conversationId: string, plan: TurnPlan): void {
    const timestamp = now();
    for (const [kind, items] of [['world', plan.worldEventProposals], ['state', plan.protagonistStateProposals.length ? [plan.protagonistStateProposals] : []]] as const) {
      for (const payload of items) this.database.db.insert(proposals).values({
        id: id(), conversationId, storyTurnId: plan.storyTurnId, originHead: this.getConversation(conversationId)?.headMessageId ?? null, kind, payload,
        status: 'pending', committedSnapshot: null, createdAt: timestamp, updatedAt: timestamp,
      }).run();
    }
  }
  listProposals(conversationId: string) { return this.database.db.select().from(proposals).where(eq(proposals.conversationId, conversationId)).orderBy(desc(proposals.createdAt)).all(); }
  updateProposal(proposalId: string, status: 'applied' | 'rejected' | 'undone', committedSnapshot: unknown = null): boolean {
    return this.database.db.update(proposals).set({ status, committedSnapshot, updatedAt: now() }).where(eq(proposals.id, proposalId)).run().changes > 0;
  }

  hasImport(sourceHash: string): boolean { return Boolean(this.database.db.select().from(imports).where(eq(imports.sourceHash, sourceHash)).get()); }
  importedEntity(kind: string, sourceHash: string): string | null {
    return (this.database.sqlite.prepare('SELECT entity_id FROM imported_files WHERE kind = ? AND source_hash = ?').get(kind, sourceHash) as { entity_id: string } | undefined)?.entity_id ?? null;
  }
  recordImportedEntity(kind: string, sourceHash: string, entityId: string): void {
    this.database.sqlite.prepare('INSERT OR REPLACE INTO imported_files (kind, source_hash, entity_id) VALUES (?, ?, ?)').run(kind, sourceHash, entityId);
  }
  getProposal(proposalId: string) { return this.database.db.select().from(proposals).where(eq(proposals.id, proposalId)).get() ?? null; }
  listImports() { return this.database.db.select().from(imports).orderBy(desc(imports.createdAt)).all(); }
  events(conversationId: string): SessionEvent[] {
    return this.database.db.select().from(sessionEvents).where(eq(sessionEvents.conversationId, conversationId)).orderBy(asc(sessionEvents.id)).all() as SessionEvent[];
  }
  checkpointActive(conversationId: string, checkpointId: string): boolean {
    return this.checkpointFilter(conversationId)(checkpointId);
  }
  private checkpointFilter(conversationId: string) {
    const heads = new Set(this.getActiveBranch(conversationId).map((message) => message.id));
    const checkpoints = new Map(this.events(conversationId).filter((event) => event.type === 'checkpoint').map((event) => {
      const value = event.payload as { id: string; head: string | null }; return [value.id, value.head];
    }));
    return (checkpointId: string) => { const head = checkpoints.get(checkpointId); return !head || heads.has(head); };
  }
  currentWorld(conversationId: string): Array<{ summary: string; evidence: string }> {
    const heads = new Set(this.getActiveBranch(conversationId).map((message) => message.id));
    const applied = new Map<string, { summary: string; evidence: string }>();
    for (const event of this.events(conversationId)) {
      if (event.type !== 'world.applied' && event.type !== 'world.undone') continue;
      const value = event.payload as { head: string | null; proposalId: string; summary: string; evidence: string };
      if (value.head && !heads.has(value.head)) continue;
      if (event.type === 'world.undone') applied.delete(value.proposalId);
      else applied.set(value.proposalId, { summary: value.summary, evidence: value.evidence });
    }
    return [...applied.values()];
  }
  redactError(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error);
    for (const row of this.database.db.select().from(connections).all()) {
      for (const secret of [row.apiKey, ...Object.values(row.headers)]) if (secret) text = text.replaceAll(secret, '[redacted]');
    }
    return text.slice(0, 4000);
  }
  recoverInterruptedTurns(): void {
    for (const turn of this.database.db.select().from(turns).where(inArray(turns.status, ['queued', 'running'])).all()) {
      this.updateTurn(turn.id, { status: 'failed', error: 'Server restarted during generation.', completedAt: now() });
      this.addEvent(turn.conversationId, turn.id, 'turn.failed', { turnId: turn.id, error: 'Server restarted during generation.' });
    }
  }
  recordImport(sourcePath: string, sourceHash: string, report: unknown): void {
    this.database.db.insert(imports).values({ id: id(), sourcePath, sourceHash, report, createdAt: now() }).run();
  }

  getCharactersByIds(ids: string[]): Character[] {
    if (ids.length === 0) return [];
    const rows = this.database.db.select().from(characters).where(inArray(characters.id, ids)).all() as Character[];
    const byId = new Map(rows.map((character) => [character.id, character]));
    return ids.flatMap((characterId) => byId.get(characterId) ? [byId.get(characterId)!] : []);
  }
}
