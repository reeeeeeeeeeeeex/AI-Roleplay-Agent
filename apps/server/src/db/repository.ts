import { AppError, errorText, uiText, type UiText } from '@new-ai-chat/contracts';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, sql } from 'drizzle-orm';
import { defaultPromptSettings, generalSettingsSchema, personaInputSchema, personaStateTemplateSchema, promptSettingsSchema, promptPresetSchema, type GeneralSettings, type PromptSettings, type PromptPreset, type PromptPresetInput, type PromptPresetPatch, type TurnTrace } from '@new-ai-chat/contracts';
import type {
  Character,
  CharacterInput,
  ConnectionInput,
  ConnectionSummary,
  Conversation,
  Group,
  Lorebook,
  MemoryEntry,
  PinnedFact,
  StoryBookmark,
  StoryNavigation,
  MessageNode,
  MessageSummary,
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

function branchIds(conversationId: string, headMessageId: string) {
  // UNION terminates corrupt cycles; orderedBranch still reports them as errors.
  return sql`(WITH RECURSIVE branch(id, parent_id) AS (
    SELECT id, parent_id FROM messages WHERE id = ${headMessageId} AND conversation_id = ${conversationId}
    UNION
    SELECT parent.id, parent.parent_id FROM messages AS parent JOIN branch ON parent.id = branch.parent_id
    WHERE parent.conversation_id = ${conversationId}
  ) SELECT id FROM branch)`;
}

function orderedBranch<T extends Pick<MessageNode, 'id' | 'parentId'>>(nodes: T[], headMessageId: string): T[] {
  const all = new Map(nodes.map(message => [message.id, message]));
  const branch: T[] = []; let current = all.get(headMessageId);
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) throw new AppError("Cycle in message branch.");
    visited.add(current.id); branch.push(current);
    current = current.parentId ? all.get(current.parentId) : undefined;
  }
  return branch.reverse();
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    branchGroupId: row.branchGroupId,
    authorNote: row.authorNote,
    id: row.id,
    title: row.title,
    kind: row.kind as Conversation['kind'],
    characterId: row.characterId,
    groupId: row.groupId,
    personaId: row.personaId,
    lorebookIds: row.lorebookIds,
    headMessageId: row.headMessageId,
    historyStartMessageId: row.historyStartMessageId,
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
    generationInfo: row.generationInfo,
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
    progress: row.progress,
    recordsStatus: row.recordsStatus as TurnRecord['recordsStatus'],
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export class Repository {
  constructor(readonly database: AppDatabase) {
    database.sqlite.transaction(() => {
      const settings = database.db.select().from(appSettings).all();
      const general = settings.find(row => row.key === 'general')?.value as Partial<GeneralSettings> | undefined;
      if (general) {
        if (general.historyMessageLimit === undefined) this.setGeneralSettings(generalSettingsSchema.parse({ ...general, historyMessageLimit: general.connectionId ? this.getRuntimeConnection(general.connectionId)?.historyMessageLimit ?? 0 : 0 }));
        return;
      }
      const previous = settings.find(row => row.key === 'defaultConnection')?.value;
      this.setGeneralSettings(generalSettingsSchema.parse({
        connectionId: typeof previous === 'string' && this.getRuntimeConnection(previous) ? previous : null,
        historyMessageLimit: typeof previous === 'string' ? this.getRuntimeConnection(previous)?.historyMessageLimit ?? 0 : 0,
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
    if (settings.connectionId && !this.getRuntimeConnection(settings.connectionId)) throw new AppError("Connection not found.");
    if (settings.recordConnectionId && !this.getRuntimeConnection(settings.recordConnectionId)) throw new AppError("Memory / 主角状态连接不存在。");
    if (settings.defaultPersonaId && !this.getPersona(settings.defaultPersonaId)) throw new AppError("Persona not found.");
    const choiceConnectionId = settings.actionChoices.connectionId ?? settings.connectionId;
    const choiceConnection = choiceConnectionId ? this.getRuntimeConnection(choiceConnectionId) : null;
    if (settings.actionChoices.connectionId && !choiceConnection) throw new AppError("行动选项连接不存在。");
    if (choiceConnection?.protocol === 'anthropic-messages' && (settings.actionChoices.temperature ?? choiceConnection.temperature) > 1) throw new AppError("Anthropic 的行动选项温度不能超过 1。");
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
  listPromptPresets(): PromptPreset[] {
    const row = this.database.db.select().from(appSettings).where(eq(appSettings.key, 'promptPresets')).get();
    return promptPresetSchema.array().parse(row?.value ?? []);
  }
  private writePromptPresets(presets: PromptPreset[]) {
    this.database.db.insert(appSettings).values({ key: 'promptPresets', value: presets })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: presets } }).run();
  }
  createPromptPreset(input: PromptPresetInput): PromptPreset {
    return this.database.sqlite.transaction(() => {
      const presets = this.listPromptPresets();
      const preset = promptPresetSchema.parse({ ...input, id: id() });
      if (presets.some(item => item.name === preset.name)) throw new AppError("预设名称已存在。");
      this.writePromptPresets([...presets, preset]);
      return preset;
    })();
  }
  updatePromptPreset(presetId: string, input: PromptPresetPatch): PromptPreset | null {
    return this.database.sqlite.transaction(() => {
      const presets = this.listPromptPresets();
      const index = presets.findIndex(item => item.id === presetId);
      if (index < 0) return null;
      const preset = promptPresetSchema.parse({ ...presets[index], ...input, id: presetId });
      if (presets.some(item => item.id !== presetId && item.name === preset.name)) throw new AppError("预设名称已存在。");
      presets[index] = preset;
      this.writePromptPresets(presets);
      return preset;
    })();
  }
  deletePromptPreset(presetId: string): boolean {
    return this.database.sqlite.transaction(() => {
      const presets = this.listPromptPresets();
      const remaining = presets.filter(item => item.id !== presetId);
      if (remaining.length === presets.length) return false;
      this.writePromptPresets(remaining);
      return true;
    })();
  }
  resolveConnection(overrideId?: string | null): RuntimeConnection | null {
    const settings = this.getGeneralSettings();
    const connectionId = overrideId ?? settings.connectionId;
    const connection = connectionId ? this.getRuntimeConnection(connectionId) : null;
    return connection ? { ...connection, historyMessageLimit: settings.historyMessageLimit } : null;
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
      if (settings.connectionId === connectionId || settings.actionChoices.connectionId === connectionId || settings.recordConnectionId === connectionId) this.setGeneralSettings({ ...settings,
        connectionId: settings.connectionId === connectionId ? null : settings.connectionId,
        recordConnectionId: settings.recordConnectionId === connectionId ? null : settings.recordConnectionId,
        actionChoices: { ...settings.actionChoices, connectionId: settings.actionChoices.connectionId === connectionId ? null : settings.actionChoices.connectionId },
      });
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

  listPersonas(): Persona[] { return this.database.db.select().from(personas).orderBy(asc(personas.name)).all().map(row => ({ ...row, stateTemplate: personaStateTemplateSchema.parse(row.stateTemplate) })) as Persona[]; }
  getPersona(personaId: string): Persona | null { const row = this.database.db.select().from(personas).where(eq(personas.id, personaId)).get(); return row ? { ...row, stateTemplate: personaStateTemplateSchema.parse(row.stateTemplate) } as Persona : null; }
  createPersona(input: { name: string; description: string; avatarPath: string | null; stateTemplate?: unknown; legacyPayload?: unknown }): Persona {
    const timestamp = now(); const row = { id: id(), ...personaInputSchema.parse(input), createdAt: timestamp, updatedAt: timestamp };
    this.database.db.insert(personas).values(row).run(); return this.getPersona(row.id)!;
  }
  updatePersona(personaId: string, input: { name: string; description: string; avatarPath: string | null; stateTemplate?: unknown; legacyPayload?: unknown }): Persona | null {
    if (!this.getPersona(personaId)) return null;
    this.database.db.update(personas).set({ ...personaInputSchema.parse(input), updatedAt: now() }).where(eq(personas.id, personaId)).run(); return this.getPersona(personaId);
  }
  resolvePersona(personaId: string | null): Persona | null {
    const selected = personaId ?? this.getGeneralSettings().defaultPersonaId;
    return selected ? this.getPersona(selected) : null;
  }
  deletePersona(personaId: string): boolean {
    return this.database.sqlite.transaction(() => {
      const settings = this.getGeneralSettings();
      if (settings.defaultPersonaId === personaId) this.setGeneralSettings({ ...settings, defaultPersonaId: null });
      return this.database.db.delete(personas).where(eq(personas.id, personaId)).run().changes > 0;
    })();
  }

  listGroups(): Group[] { return this.database.db.select().from(groups).orderBy(asc(groups.name)).all() as Group[]; }
  getGroup(groupId: string): Group | null { return this.database.db.select().from(groups).where(eq(groups.id, groupId)).get() as Group | undefined ?? null; }
  createGroup(input: { name: string; memberIds: string[]; scenario: string; avatarPath?: string | null }, legacyPayload: unknown = null): Group {
    const timestamp = now(); const row = { id: id(), ...input, avatarPath: input.avatarPath ?? null, legacyPayload, createdAt: timestamp, updatedAt: timestamp };
    this.database.db.insert(groups).values(row).run(); return this.getGroup(row.id)!;
  }
  updateGroup(groupId: string, input: { name: string; memberIds: string[]; scenario: string; avatarPath?: string | null }): Group | null {
    if (!this.getGroup(groupId)) return null;
    this.database.db.update(groups).set({ ...input, avatarPath: input.avatarPath ?? null, updatedAt: now() }).where(eq(groups.id, groupId)).run(); return this.getGroup(groupId);
  }
  deleteGroup(groupId: string): boolean { return this.database.db.delete(groups).where(eq(groups.id, groupId)).run().changes > 0; }

  listLorebooks(): Lorebook[] {
    const books = this.database.db.select().from(lorebooks).orderBy(asc(lorebooks.name)).all().map(book => ({ ...book, entries: [] as Lorebook['entries'] }));
    if (!books.length) return books;
    const entriesByBook = new Map(books.map(book => [book.id, book.entries]));
    for (const entry of this.database.db.select().from(loreEntries).orderBy(asc(loreEntries.order)).all()) {
      entriesByBook.get(entry.lorebookId)?.push({ ...entry, position: entry.position as 'before' | 'after' | 'depth' });
    }
    return books;
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
  createConversation(input: Omit<Conversation, 'id' | 'branchGroupId' | 'headMessageId' | 'historyStartMessageId' | 'createdAt' | 'updatedAt'>): Conversation {
    const timestamp = now(); const conversationId = id();
    this.database.db.insert(conversations).values({
      id: conversationId, title: input.title, kind: input.kind, characterId: input.characterId, groupId: input.groupId,
      personaId: input.personaId, lorebookIds: input.lorebookIds,
      authorNote: input.authorNote,
      scenario: input.scenario,
      createdAt: timestamp, updatedAt: timestamp,
    }).run();
    return this.getConversation(conversationId)!;
  }
  updateConversation(conversationId: string, input: Omit<Conversation, 'id' | 'branchGroupId' | 'headMessageId' | 'historyStartMessageId' | 'createdAt' | 'updatedAt'>): Conversation | null {
    if (!this.getConversation(conversationId)) return null;
    this.database.db.update(conversations).set({
      title: input.title, kind: input.kind, characterId: input.characterId, groupId: input.groupId,
      personaId: input.personaId, lorebookIds: input.lorebookIds, updatedAt: now(),
      authorNote: input.authorNote,
      scenario: input.scenario,
    }).where(eq(conversations.id, conversationId)).run();
    return this.getConversation(conversationId);
  }
  deleteConversation(conversationId: string): boolean { return this.database.db.delete(conversations).where(eq(conversations.id, conversationId)).run().changes > 0; }

  listMessages(conversationId: string): MessageNode[] {
    return this.database.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).all().map(mapMessage);
  }
  listMessageSummaries(conversationId: string): MessageSummary[] {
    // A byte prefix bounds reads and preserves embedded NULs; coalesce preserves empty text after SQLite slices an empty BLOB.
    return this.database.db.select({ id: messages.id, parentId: messages.parentId, role: messages.role, speaker: messages.speaker,
      content: sql<string>`coalesce(CAST(substr(CAST(${messages.content} AS BLOB), 1, 400) AS TEXT), '')`,
    }).from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).all()
      .map(row => ({ ...row, role: row.role as MessageSummary['role'], content: row.content.slice(0, 100) }));
  }
  getMessage(messageId: string): MessageNode | null {
    const row = this.database.db.select().from(messages).where(eq(messages.id, messageId)).get(); return row ? mapMessage(row) : null;
  }
  getActiveBranch(conversationId: string, headMessageId = this.getConversation(conversationId)?.headMessageId, nodes?: MessageNode[]): MessageNode[] {
    if (!headMessageId) return [];
    // Follow IDs first so alternate versions' prose and provider state are never decoded.
    const selected = nodes ?? this.database.db.select().from(messages).where(inArray(messages.id, branchIds(conversationId, headMessageId))).all().map(mapMessage);
    return orderedBranch(selected, headMessageId);
  }
  private activeMessageIds(conversationId: string): Set<string> {
    const head = this.getConversation(conversationId)?.headMessageId;
    if (!head) return new Set();
    const links = this.database.db.select({ id: messages.id, parentId: messages.parentId }).from(messages)
      .where(inArray(messages.id, branchIds(conversationId, head))).all();
    return new Set(orderedBranch(links, head).map(message => message.id));
  }
  createMessage(input: Omit<MessageNode, 'id' | 'createdAt' | 'generationInfo'> & { generationInfo?: MessageNode['generationInfo'] }): MessageNode {
    const row = { ...input, generationInfo: input.generationInfo ?? null, id: id(), createdAt: now() };
    this.database.db.insert(messages).values(row).run(); return this.getMessage(row.id)!;
  }
  setHead(conversationId: string, messageId: string | null): void {
    if (messageId && this.getMessage(messageId)?.conversationId !== conversationId) throw new AppError("Invalid branch head.");
    this.database.db.update(conversations).set({ headMessageId: messageId, updatedAt: now() }).where(eq(conversations.id, conversationId)).run();
  }
  setHistoryStart(conversationId: string, messageId: string | null): Conversation {
    if (!this.getConversation(conversationId)) throw new AppError("Conversation not found.");
    if (messageId && !this.getActiveBranch(conversationId).some(message => message.id === messageId && message.role !== 'system')) throw new AppError("发送起点必须是当前分支中的故事消息。");
    this.database.db.update(conversations).set({ historyStartMessageId: messageId, updatedAt: now() }).where(eq(conversations.id, conversationId)).run();
    return this.getConversation(conversationId)!;
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
  updateTurn(turnId: string, values: Partial<Pick<TurnRecord, 'status' | 'plan' | 'progress' | 'recordsStatus' | 'error' | 'completedAt'>>): TurnRecord {
    this.database.db.update(turns).set(values).where(eq(turns.id, turnId)).run(); return this.getTurn(turnId)!;
  }

  addEvent(conversationId: string, turnId: string | null, type: string, payload: unknown): SessionEvent {
    const createdAt = now();
    const result = this.database.db.insert(sessionEvents).values({ conversationId, turnId, type, payload, createdAt }).run();
    return { id: Number(result.lastInsertRowid), conversationId, turnId, type, payload, createdAt };
  }
  eventsForTurn(turnId: string, afterId = 0): SessionEvent[] {
    return this.database.db.select().from(sessionEvents)
      .where(and(eq(sessionEvents.turnId, turnId), gt(sessionEvents.id, afterId)))
      .orderBy(asc(sessionEvents.id)).all() as SessionEvent[];
  }
  hasTerminalEvent(turnId: string): boolean {
    return Boolean(this.database.db.select({ id: sessionEvents.id }).from(sessionEvents)
      .where(and(eq(sessionEvents.turnId, turnId), inArray(sessionEvents.type, ['turn.completed', 'turn.partial', 'turn.failed', 'turn.cancelled'])))
      .limit(1).get());
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
      speaker: input.speaker,
      request: this.traceSafe(input.request), response: this.traceSafe(input.response),
      contextReport: input.contextReport ?? null,
      tools: this.traceSafe(input.tools) as unknown[], thinking: input.thinking,
      events: this.traceSafe(input.events ?? []) as TurnTrace['events'],
      usage: input.usage, timing: input.timing, error: input.error, createdAt: now(), completedAt: null,
    };
    this.database.db.insert(turnTraces).values(row).run();
    return row as TurnTrace;
  }
  updateTrace(traceId: string, values: Partial<Pick<TurnTrace, 'status' | 'request' | 'response' | 'tools' | 'events' | 'thinking' | 'usage' | 'timing' | 'error' | 'completedAt'>>): void {
    const patch = { ...values, request: values.request === undefined ? undefined : this.traceSafe(values.request), response: values.response === undefined ? undefined : this.traceSafe(values.response), tools: values.tools === undefined ? undefined : this.traceSafe(values.tools) as unknown[], events: values.events === undefined ? undefined : this.traceSafe(values.events) as TurnTrace['events'] };
    this.database.db.update(turnTraces).set(patch).where(eq(turnTraces.id, traceId)).run();
  }
  getTraceMetadata(traceId: string) {
    return this.database.db.select({ phase: turnTraces.phase, timing: turnTraces.timing, tools: turnTraces.tools })
      .from(turnTraces).where(eq(turnTraces.id, traceId)).get() ?? null;
  }
  listTraces(turnId: string): TurnTrace[] {
    return this.database.db.select().from(turnTraces).where(eq(turnTraces.turnId, turnId)).orderBy(asc(turnTraces.requestIndex)).all() as TurnTrace[];
  }
  getTrace(traceId: string, live = false) {
    const { request, response, contextReport, ...liveColumns } = getTableColumns(turnTraces);
    return this.database.db.select(live ? liveColumns : getTableColumns(turnTraces)).from(turnTraces).where(eq(turnTraces.id, traceId)).get() ?? null;
  }
  listTraceSummaries(conversationId: string) {
    const { request, response, contextReport, tools, events, thinking, ...columns } = getTableColumns(turnTraces);
    return this.database.db.select(columns).from(turnTraces).where(eq(turnTraces.conversationId, conversationId)).orderBy(desc(turnTraces.createdAt), desc(turnTraces.requestIndex)).all();
  }
  listConversationTraces(conversationId: string, limit = 20): TurnTrace[] {
    const rows = this.database.db.select().from(turnTraces).where(eq(turnTraces.conversationId, conversationId)).orderBy(desc(turnTraces.createdAt)).all() as TurnTrace[];
    const ids = new Set([...new Set(rows.map(row => row.turnId))].slice(0, limit));
    return rows.filter(row => ids.has(row.turnId));
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
    const selected = this.database.db.select({ id: memories.id }).from(memories).where(eq(memories.conversationId, conversationId))
      .orderBy(desc(sql`rowid`)).all().filter(row => active(row.id)).slice(0, limit).map(row => row.id);
    if (!selected.length) return [];
    const heads = this.activeMessageIds(conversationId);
    const edits = new Map<string, string>();
    for (const event of this.events(conversationId, ['memory.edited'])) {
      const edit = event.payload as { id: string; head: string | null; content: string };
      if (!edit.head || heads.has(edit.head)) edits.set(edit.id, edit.content);
    }
    return (this.database.db.select().from(memories).where(inArray(memories.id, selected)).orderBy(desc(sql`rowid`)).all() as MemoryEntry[])
      .map(row => edits.has(row.id) ? { ...row, content: edits.get(row.id)! } : row);
  }
  createMemory(input: Omit<MemoryEntry, 'id' | 'createdAt'>): MemoryEntry {
    const row = { ...input, coverage: input.coverage ?? null, id: id(), createdAt: now() }; this.database.db.insert(memories).values(row).run();
    this.addEvent(input.conversationId, null, 'checkpoint', { id: row.id, head: this.getConversation(input.conversationId)?.headMessageId ?? null }); return row;
  }
  latestState(conversationId: string): ProtagonistStateSnapshot | null {
    const active = this.checkpointFilter(conversationId);
    // Find the branch's checkpoint before decoding potentially large historical state tables.
    const selected = this.database.db.select({ id: stateSnapshots.id }).from(stateSnapshots).where(eq(stateSnapshots.conversationId, conversationId)).orderBy(desc(sql`rowid`)).all().find((item) => active(item.id));
    const row = selected ? this.database.db.select().from(stateSnapshots).where(eq(stateSnapshots.id, selected.id)).get() : null;
    return row ? { ...row, version: row.version as 1 | 2 } : null;
  }
  createState(conversationId: string, storyTurnId: string | null, tables: ProtagonistTables): ProtagonistStateSnapshot {
    const row = { id: id(), conversationId, storyTurnId, version: 2 as const, tables, createdAt: now() };
    this.database.db.insert(stateSnapshots).values(row).run();
    this.addEvent(conversationId, null, 'checkpoint', { id: row.id, head: this.getConversation(conversationId)?.headMessageId ?? null }); return row;
  }
  listStateSnapshots(conversationId: string): ProtagonistStateSnapshot[] {
    const active = this.checkpointFilter(conversationId);
    return this.database.db.select().from(stateSnapshots).where(eq(stateSnapshots.conversationId, conversationId)).orderBy(desc(sql`rowid`)).all().filter((row) => active(row.id)).map((row) => ({ ...row, version: row.version as 1 | 2 }));
  }
  listStateCheckpoints(conversationId: string) {
    const active = this.checkpointFilter(conversationId);
    return this.database.db.select({ id: stateSnapshots.id, createdAt: stateSnapshots.createdAt }).from(stateSnapshots)
      .where(eq(stateSnapshots.conversationId, conversationId)).orderBy(desc(sql`rowid`)).all().filter(row => active(row.id));
  }
  getStateSnapshot(conversationId: string, snapshotId: string): ProtagonistStateSnapshot | null {
    if (!this.checkpointActive(conversationId, snapshotId)) return null;
    const row = this.database.db.select().from(stateSnapshots).where(and(eq(stateSnapshots.conversationId, conversationId), eq(stateSnapshots.id, snapshotId))).get();
    return row ? { ...row, version: row.version as 1 | 2 } : null;
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
  events(conversationId: string, types?: string[]): SessionEvent[] {
    return this.database.db.select().from(sessionEvents)
      .where(and(eq(sessionEvents.conversationId, conversationId), types ? inArray(sessionEvents.type, types) : undefined))
      .orderBy(asc(sessionEvents.id)).all() as SessionEvent[];
  }
  checkpointActive(conversationId: string, checkpointId: string): boolean {
    return this.checkpointFilter(conversationId)(checkpointId);
  }
  listPinnedFacts(conversationId: string): PinnedFact[] {
    const heads = this.activeMessageIds(conversationId);
    const facts = new Map<string, PinnedFact>();
    for (const event of this.events(conversationId, ['fact.saved', 'fact.removed'])) {
      const value = event.payload as PinnedFact;
      if (value.head && !heads.has(value.head)) continue;
      if (event.type === 'fact.removed') facts.delete(value.id);
      else facts.set(value.id, value);
    }
    return [...facts.values()];
  }
  savePinnedFact(conversationId: string, content: string, sourceMessageId: string | null = null, factId?: string): PinnedFact {
    const chat = this.getConversation(conversationId); if (!chat) throw new AppError("Conversation not found.");
    const previous = factId ? this.listPinnedFacts(conversationId).find(fact => fact.id === factId) : null;
    if (factId && !previous) throw new AppError("Fact is not on the current branch.");
    if (sourceMessageId && !this.activeMessageIds(conversationId).has(sourceMessageId)) throw new AppError("Fact source is not on the current branch.");
    const fact = { id: factId ?? id(), content, sourceMessageId: previous?.sourceMessageId ?? sourceMessageId, head: chat.headMessageId };
    this.addEvent(conversationId, null, 'fact.saved', fact); return fact;
  }
  removePinnedFact(conversationId: string, factId: string): void {
    if (!this.listPinnedFacts(conversationId).some(fact => fact.id === factId)) throw new AppError("Fact is not on the current branch.");
    this.addEvent(conversationId, null, 'fact.removed', { id: factId, head: this.getConversation(conversationId)!.headMessageId });
  }
  listBookmarks(conversationId: string): StoryBookmark[] {
    const bookmarks = new Map<string, StoryBookmark>();
    for (const event of this.events(conversationId, ['bookmark.saved', 'bookmark.removed'])) {
      const value = event.payload as StoryBookmark;
      if (event.type === 'bookmark.saved') bookmarks.set(value.id, value);
      if (event.type === 'bookmark.removed') bookmarks.delete(value.id);
    }
    return [...bookmarks.values()];
  }
  saveBookmark(conversationId: string, name: string, messageId: string, bookmarkId?: string): StoryBookmark {
    if (this.getMessage(messageId)?.conversationId !== conversationId) throw new AppError("Bookmark target is not in this story.");
    if (bookmarkId && !this.listBookmarks(conversationId).some(bookmark => bookmark.id === bookmarkId)) throw new AppError("Bookmark not found.");
    const bookmark = { id: bookmarkId ?? id(), name, messageId };
    this.addEvent(conversationId, null, 'bookmark.saved', bookmark); return bookmark;
  }
  removeBookmark(conversationId: string, bookmarkId: string): void {
    if (!this.listBookmarks(conversationId).some(bookmark => bookmark.id === bookmarkId)) throw new AppError("Bookmark not found.");
    this.addEvent(conversationId, null, 'bookmark.removed', { id: bookmarkId });
  }
  navigation(conversationId: string): StoryNavigation {
    const chat = this.getConversation(conversationId); if (!chat) throw new AppError("Conversation not found.");
    const state = this.latestState(conversationId)?.tables;
    return { bookmarks: this.listBookmarks(conversationId), scene: {
      scenario: chat.scenario || (chat.groupId ? this.getGroup(chat.groupId)?.scenario : chat.characterId ? this.getCharacter(chat.characterId)?.scenario : '') || '',
      time: String(state?.global_state[0]?.current_time ?? ''), location: String(state?.global_state[0]?.current_location ?? ''),
      importantCharacters: (state?.important_characters ?? []).map(row => String(row.name ?? '')).filter(Boolean),
    } };
  }
  private checkpointFilter(conversationId: string) {
    const heads = this.activeMessageIds(conversationId);
    const checkpoints = new Map(this.events(conversationId, ['checkpoint']).map((event) => {
      const value = event.payload as { id: string; head: string | null }; return [value.id, value.head];
    }));
    return (checkpointId: string) => { const head = checkpoints.get(checkpointId); return !head || heads.has(head); };
  }
  currentWorld(conversationId: string): Array<{ summary: string; evidence: string }> {
    const heads = this.activeMessageIds(conversationId);
    const applied = new Map<string, { summary: string; evidence: string }>();
    for (const event of this.events(conversationId, ['world.applied', 'world.undone'])) {
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
  describeError(error: unknown): UiText | undefined {
    const text = errorText(error);
    return text && { ...text, ...(text.params ? { params: text.params.map(value => typeof value === 'number' ? value : this.redactError(value)) } : {}) };
  }
  recoverInterruptedTurns(): void {
    for (const turn of this.database.db.select().from(turns).where(inArray(turns.status, ['queued', 'running'])).all()) {
      const status = turn.progress?.completedMessageIds.length ? 'partial' : 'failed';
      this.updateTurn(turn.id, { status, error: 'Server restarted during generation.', completedAt: now() });
      this.addEvent(turn.conversationId, turn.id, `turn.${status}`, { turnId: turn.id, error: 'Server restarted during generation.', errorText: uiText('Server restarted during generation.') });
    }
    for (const turn of this.database.db.select().from(turns).where(eq(turns.recordsStatus, 'running')).all()) {
      this.updateTurn(turn.id, { recordsStatus: 'cancelled' });
      this.addEvent(turn.conversationId, turn.id, 'turn.completed', { turnId: turn.id, recordsStatus: 'cancelled' });
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
