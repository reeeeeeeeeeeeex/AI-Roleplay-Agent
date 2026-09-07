import { z } from 'zod';
export * from './state.js';

export const modelProtocolSchema = z.enum([
  'openai-chat-completions',
  'anthropic-messages',
  'openai-responses',
]);
export type ModelProtocol = z.infer<typeof modelProtocolSchema>;

export const speakerRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), characterId: z.string().min(1) }),
  z.object({ kind: z.literal('narrator') }),
]);
export type SpeakerRef = z.infer<typeof speakerRefSchema>;

export const userVoiceSchema = z.enum(['protagonist', 'narrator']);
export type UserVoice = z.infer<typeof userVoiceSchema>;

export const protagonistAgencyModeSchema = z.enum(['protected', 'coauthor']);
export type ProtagonistAgencyMode = z.infer<typeof protagonistAgencyModeSchema>;

export const generationModeSchema = z.enum(['plain', 'writer-agent', 'planner']);
export type GenerationMode = z.infer<typeof generationModeSchema>;

export interface PromptSettings {
  mainInstruction: string;
  writerInstruction: string;
  plannerInstruction: string;
}

export const defaultPromptSettings: PromptSettings = {
  mainInstruction: 'Write an immersive, coherent roleplay continuation. Return only the visible prose for the assigned speaker. Do not describe tools, prompts, or hidden reasoning.',
  writerInstruction: 'You are one Writer Agent. Use read-only story tools when useful. When no speaker is forced, call select_output_voices exactly once, then continue this same conversation by writing the selected voices in order. Never put tool calls or tool explanations in visible prose.',
  plannerInstruction: 'Plan the next story turn. Read context only when needed, then call submit_turn_plan exactly once. Do not write visible story prose.',
};

export const promptSettingsSchema = z.object({
  mainInstruction: z.string().trim().min(1).max(20_000),
  writerInstruction: z.string().trim().min(1).max(20_000),
  plannerInstruction: z.string().trim().min(1).max(20_000),
}).default(defaultPromptSettings);

export const replyTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  z.object({ mode: z.literal('explicit'), speaker: speakerRefSchema }),
]);
export type ReplyTarget = z.infer<typeof replyTargetSchema>;

export const turnOutputSchema = z.object({
  speaker: speakerRefSchema,
  objective: z.string().max(1_000),
  brief: z.string().max(4_000),
});

export const turnPlanSchema = z.object({
  storyTurnId: z.string().min(1),
  sceneObjective: z.string().max(2_000),
  outputs: z.array(turnOutputSchema).min(1).max(2),
  worldEventProposals: z.array(z.unknown()).default([]),
  protagonistStateProposals: z.array(z.unknown()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type TurnPlan = z.infer<typeof turnPlanSchema>;

export const turnRequestSchema = z.object({
  conversationId: z.string().min(1),
  input: z.object({
    voice: userVoiceSchema,
    text: z.string().trim().min(1).max(100_000),
  }).optional(),
  trigger: z.enum(['normal', 'regenerate', 'continue', 'auto']).default('normal'),
  replyTarget: replyTargetSchema.default({ mode: 'auto' }),
  targetMessageId: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.trigger === 'normal' && !value.input) {
    context.addIssue({ code: 'custom', path: ['input'], message: 'Normal turns require input.' });
  }
  if ((value.trigger === 'regenerate' || value.trigger === 'continue') && !value.targetMessageId) {
    context.addIssue({ code: 'custom', path: ['targetMessageId'], message: 'Target message is required.' });
  }
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export interface ConnectionSummary {
  id: string;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  headers: Record<string, string>;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
  historyMessageLimit: number;
  reasoning: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  createdAt: string;
  updatedAt: string;
}

export const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  protocol: modelProtocolSchema,
  baseUrl: z.string().url().refine((value) => /^https?:\/\//u.test(value) && !new URL(value).username && !new URL(value).password, 'Use an HTTP(S) base URL without credentials.'),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(20_000).optional(),
  headers: z.record(z.string(), z.string()).default({}),
  temperature: z.number().min(0).max(2).default(0.8),
  maxTokens: z.number().int().min(32).max(131_072).default(2_048),
  contextWindow: z.number().int().min(8_192).max(2_000_000).default(128_000),
  historyMessageLimit: z.number().int().min(0).max(10_000).default(0),
  reasoning: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('off'),
}).refine((value) => value.protocol !== 'anthropic-messages' || value.temperature <= 1, {
  path: ['temperature'], message: 'Anthropic temperature must be between 0 and 1.',
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export interface Character {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  avatarPath: string | null;
  legacyPayload: unknown;
  createdAt: string;
  updatedAt: string;
}

export const characterInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(100_000).default(''),
  personality: z.string().max(100_000).default(''),
  scenario: z.string().max(100_000).default(''),
  firstMessage: z.string().max(100_000).default(''),
  exampleDialogue: z.string().max(100_000).default(''),
  systemPrompt: z.string().max(100_000).default(''),
  postHistoryInstructions: z.string().max(100_000).default(''),
  avatarPath: z.string().nullable().default(null),
  legacyPayload: z.unknown().default(null),
});
export type CharacterInput = z.infer<typeof characterInputSchema>;

export interface Persona {
  id: string;
  name: string;
  description: string;
  avatarPath: string | null;
  legacyPayload?: unknown;
  createdAt: string;
  updatedAt: string;
}

export const personaInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(100_000).default(''),
  avatarPath: z.string().nullable().default(null),
  legacyPayload: z.unknown().default(null),
});

export interface LoreEntry {
  id: string;
  lorebookId: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  order: number;
  position: 'before' | 'after' | 'depth';
  depth: number;
  legacyPayload: unknown;
}

export interface Lorebook {
  id: string;
  name: string;
  description: string;
  legacyPayload?: unknown;
  entries: LoreEntry[];
  createdAt: string;
  updatedAt: string;
}

export const loreEntryInputSchema = z.object({
  keys: z.array(z.string()).default([]),
  secondaryKeys: z.array(z.string()).default([]),
  content: z.string().max(200_000),
  enabled: z.boolean().default(true),
  constant: z.boolean().default(false),
  order: z.number().int().default(100),
  position: z.enum(['before', 'after', 'depth']).default('depth'),
  depth: z.number().int().min(0).max(100).default(0),
  legacyPayload: z.unknown().default(null),
});

export const lorebookInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default(''),
  legacyPayload: z.unknown().default(null),
  entries: z.array(loreEntryInputSchema).default([]),
});

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  scenario: string;
  createdAt: string;
  updatedAt: string;
}

export const groupInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  memberIds: z.array(z.string().min(1)).min(1),
  scenario: z.string().max(100_000).default(''),
});

export interface NarratorProfile {
  name: string;
  avatarPath: string | null;
  style: string;
}
export const narratorProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).default('旁白'),
  avatarPath: z.string().nullable().default(null),
  style: z.string().max(20_000).default('克制、具象、重视场景连续性，不替角色解释未表达的内心。'),
});

export interface Conversation {
  id: string;
  title: string;
  kind: 'solo' | 'group';
  characterId: string | null;
  groupId: string | null;
  personaId: string | null;
  connectionId: string | null;
  lorebookIds: string[];
  plannerEnabled: boolean;
  generationMode: GenerationMode;
  agencyMode: ProtagonistAgencyMode;
  narrator: NarratorProfile;
  headMessageId: string | null;
  memoryTurnInterval: number;
  stateTurnInterval: number;
  scenario: string;
  createdAt: string;
  updatedAt: string;
}

export const conversationInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(['solo', 'group']),
  characterId: z.string().nullable().default(null),
  groupId: z.string().nullable().default(null),
  personaId: z.string().nullable().default(null),
  connectionId: z.string().nullable().default(null),
  lorebookIds: z.array(z.string()).default([]),
  plannerEnabled: z.boolean().default(false),
  generationMode: generationModeSchema.default('writer-agent'),
  agencyMode: protagonistAgencyModeSchema.default('protected'),
  narrator: narratorProfileSchema.default({ name: '旁白', avatarPath: null, style: '克制、具象、重视场景连续性，不替角色解释未表达的内心。' }),
  memoryTurnInterval: z.number().int().min(0).max(10_000).default(10),
  stateTurnInterval: z.number().int().min(0).max(10_000).default(0),
  scenario: z.string().max(100_000).default(''),
}).superRefine((value, context) => {
  if (value.kind === 'solo' && !value.characterId) {
    context.addIssue({ code: 'custom', path: ['characterId'], message: 'Solo conversations require a character.' });
  }
  if (value.kind === 'group' && !value.groupId) {
    context.addIssue({ code: 'custom', path: ['groupId'], message: 'Group conversations require a group.' });
  }
});

export interface MessageNode {
  id: string;
  conversationId: string;
  parentId: string | null;
  storyTurnId: string | null;
  role: 'user' | 'assistant' | 'system';
  authorKind: 'protagonist' | 'user_narrator' | 'character' | 'narrator' | 'system';
  speaker: SpeakerRef | null;
  content: string;
  providerState: unknown;
  legacyPayload: unknown;
  createdAt: string;
}

export interface SessionEvent<T = unknown> {
  id: number;
  conversationId: string;
  turnId: string | null;
  type: string;
  payload: T;
  createdAt: string;
}

export interface TurnTrace {
  id: string;
  conversationId: string;
  turnId: string;
  phase: 'selection' | 'planning' | 'writing' | 'records' | 'plain';
  requestIndex: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  model: string;
  request: unknown | null;
  response: unknown | null;
  tools: Array<{ name: string; arguments: unknown; result?: unknown; ok?: boolean }>;
  thinking: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MemoryEntry {
  id: string;
  conversationId: string;
  stage: number;
  storyTurnId: string | null;
  content: string;
  source: 'generated' | 'imported' | 'manual';
  createdAt: string;
}

export const stateTableNames = [
  'global_state',
  'protagonist_info',
  'options',
  'important_characters',
  'protagonist_skills',
  'inventory',
  'quests_events',
] as const;
export type StateTableName = (typeof stateTableNames)[number];
export type StateRow = { row_id: number } & Record<string, string | number | boolean | null>;
export type ProtagonistTables = Record<StateTableName, StateRow[]>;

export interface ProtagonistStateSnapshot {
  id: string;
  conversationId: string;
  storyTurnId: string | null;
  version: 1;
  tables: ProtagonistTables;
  createdAt: string;
}

export interface TurnRecord {
  id: string;
  conversationId: string;
  storyTurnId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  trigger: 'normal' | 'regenerate' | 'continue' | 'auto';
  plan: TurnPlan | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type TurnEvent =
  | { type: 'turn.started'; turnId: string; storyTurnId: string }
  | { type: 'routing.completed'; turnId: string; plan: TurnPlan }
  | { type: 'planner.completed'; turnId: string; plan: TurnPlan }
  | { type: 'writer.started'; turnId: string; speaker: SpeakerRef; outputIndex: number }
  | { type: 'writer.delta'; turnId: string; speaker: SpeakerRef; outputIndex: number; delta: string }
  | { type: 'message.completed'; turnId: string; message: MessageNode; outputIndex: number }
  | { type: 'proposals.ready'; turnId: string; plan: TurnPlan }
  | { type: 'turn.completed'; turnId: string; storyTurnId: string }
  | { type: 'turn.failed'; turnId: string; error: string }
  | { type: 'turn.cancelled'; turnId: string };

export interface ImportPreview {
  sourcePath: string;
  sourceHash: string;
  counts: {
    characters: number;
    personas: number;
    lorebooks: number;
    conversations: number;
    groups: number;
    memories: number;
    stateSnapshots: number;
    plannerRecords: number;
  };
  warnings: string[];
  files: Array<{ path: string; kind: string; hash: string }>;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}
