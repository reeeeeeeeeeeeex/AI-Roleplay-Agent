import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  GenerationInfo,
  RequestTiming,
  ProtagonistTables,
  SpeakerRef,
  TurnPlan,
  TurnProgress,
  MemoryCoverage,
  ContextReport,
} from '@new-ai-chat/contracts';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};
export const appSettings = sqliteTable('app_settings', { key: text('key').primaryKey(), value: text('value', { mode: 'json' }).$type<unknown>().notNull() });

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  protocol: text('protocol').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  apiKey: text('api_key').notNull().default(''),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  temperature: integer('temperature_milli').notNull().default(800),
  maxTokens: integer('max_tokens').notNull().default(2048),
  contextWindow: integer('context_window').notNull().default(128000),
  historyMessageLimit: integer('history_message_limit').notNull().default(0),
  reasoning: text('reasoning').notNull().default('off'),
  ...timestamps,
});

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  personality: text('personality').notNull().default(''),
  scenario: text('scenario').notNull().default(''),
  firstMessage: text('first_message').notNull().default(''),
  exampleDialogue: text('example_dialogue').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  postHistoryInstructions: text('post_history_instructions').notNull().default(''),
  avatarPath: text('avatar_path'),
  legacyPayload: text('legacy_payload', { mode: 'json' }).$type<unknown>(),
  ...timestamps,
});

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarPath: text('avatar_path'),
  legacyPayload: text('legacy_payload', { mode: 'json' }).$type<unknown>(),
  ...timestamps,
});

export const lorebooks = sqliteTable('lorebooks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  legacyPayload: text('legacy_payload', { mode: 'json' }).$type<unknown>(),
  ...timestamps,
});

export const loreEntries = sqliteTable('lore_entries', {
  id: text('id').primaryKey(),
  lorebookId: text('lorebook_id').notNull().references(() => lorebooks.id, { onDelete: 'cascade' }),
  keys: text('keys', { mode: 'json' }).$type<string[]>().notNull(),
  secondaryKeys: text('secondary_keys', { mode: 'json' }).$type<string[]>().notNull(),
  content: text('content').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  constant: integer('constant', { mode: 'boolean' }).notNull().default(false),
  order: integer('sort_order').notNull().default(100),
  position: text('position').notNull().default('depth'),
  depth: integer('depth').notNull().default(0),
  legacyPayload: text('legacy_payload', { mode: 'json' }).$type<unknown>(),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  memberIds: text('member_ids', { mode: 'json' }).$type<string[]>().notNull(),
  scenario: text('scenario').notNull().default(''),
  avatarPath: text('avatar_path'),
  legacyPayload: text('legacy_payload', { mode: 'json' }).$type<unknown>(),
  ...timestamps,
});

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  characterId: text('character_id').references(() => characters.id, { onDelete: 'set null' }),
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  personaId: text('persona_id').references(() => personas.id, { onDelete: 'set null' }),
  lorebookIds: text('lorebook_ids', { mode: 'json' }).$type<string[]>().notNull(),
  headMessageId: text('head_message_id'),
  completedTurns: integer('completed_turns').notNull().default(0),
  scenario: text('scenario').notNull().default(''),
  ...timestamps,
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  storyTurnId: text('story_turn_id'),
  role: text('role').notNull(),
  authorKind: text('author_kind').notNull(),
  speaker: text('speaker', { mode: 'json' }).$type<SpeakerRef | null>(),
  content: text('content').notNull(),
  providerState: text('provider_state', { mode: 'json' }).$type<unknown>(),
  generationInfo: text('generation_info', { mode: 'json' }).$type<GenerationInfo | null>(),
  legacyPayload: text('legacy_payload', { mode: 'json' }).$type<unknown>(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('messages_conversation_id_idx').on(table.conversationId, table.id),
]);

export const turns = sqliteTable('turns', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  storyTurnId: text('story_turn_id').notNull(),
  status: text('status').notNull(),
  trigger: text('trigger').notNull(),
  plan: text('plan', { mode: 'json' }).$type<TurnPlan | null>(),
  progress: text('progress', { mode: 'json' }).$type<TurnProgress | null>(),
  recordsStatus: text('records_status').notNull().default('idle'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const sessionEvents = sqliteTable('session_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  turnId: text('turn_id'),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>(),
  createdAt: text('created_at').notNull(),
});

export const turnTraces = sqliteTable('turn_traces', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  turnId: text('turn_id').notNull(),
  phase: text('phase').notNull(),
  requestIndex: integer('request_index').notNull(),
  status: text('status').notNull().default('running'),
  model: text('model').notNull().default(''),
  speaker: text('speaker', { mode: 'json' }).$type<SpeakerRef | null>(),
  request: text('request', { mode: 'json' }).$type<unknown>(),
  contextReport: text('context_report', { mode: 'json' }).$type<ContextReport | null>(),
  response: text('response', { mode: 'json' }).$type<unknown>(),
  tools: text('tools', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  thinking: text('thinking'),
  usage: text('usage', { mode: 'json' }).$type<unknown>(),
  timing: text('timing', { mode: 'json' }).$type<RequestTiming | null>(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  stage: integer('stage').notNull(),
  storyTurnId: text('story_turn_id'),
  content: text('content').notNull(),
  source: text('source').notNull(),
  coverage: text('coverage', { mode: 'json' }).$type<MemoryCoverage | null>(),
  createdAt: text('created_at').notNull(),
});

export const stateSnapshots = sqliteTable('state_snapshots', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  storyTurnId: text('story_turn_id'),
  version: integer('version').notNull().default(1),
  tables: text('tables', { mode: 'json' }).$type<ProtagonistTables>().notNull(),
  createdAt: text('created_at').notNull(),
});

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  storyTurnId: text('story_turn_id').notNull(),
  originHead: text('origin_head'),
  kind: text('kind').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>(),
  status: text('status').notNull().default('pending'),
  committedSnapshot: text('committed_snapshot', { mode: 'json' }).$type<unknown>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const imports = sqliteTable('imports', {
  id: text('id').primaryKey(),
  sourcePath: text('source_path').notNull(),
  sourceHash: text('source_hash').notNull().unique(),
  report: text('report', { mode: 'json' }).$type<unknown>(),
  createdAt: text('created_at').notNull(),
});
