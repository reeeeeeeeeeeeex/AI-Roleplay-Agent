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

export const protagonistAgencyModeSchema = z.enum(['protected', 'coauthor', 'none']);
export type ProtagonistAgencyMode = z.infer<typeof protagonistAgencyModeSchema>;

export const defaultAgencyPrompts = {
  protected: 'Protected User mode is active. Never invent User’s dialogue, private thoughts, voluntary decisions, consent, or decisive actions. You may describe the world and externally observable consequences. User-authored narration is authoritative and may control User.',
  coauthor: 'Coauthor mode is active. You may write User’s dialogue, thoughts, and actions when it improves the story. User-authored narration remains authoritative.',
};

export const generationModeSchema = z.enum(['plain', 'writer-agent', 'planner']);
export type GenerationMode = z.infer<typeof generationModeSchema>;

export interface PromptSettings {
  mainInstruction: string;
  additionalInstruction: string;
  groupInstruction: string;
  writerInstruction: string;
  plannerInstruction: string;
}

const legacyMainInstruction = "Continue the current fictional roleplay as {{char}} and the scene narrator, faithfully preserving established characterization, relationships, world rules, and scene continuity while responding directly to {{user}}'s latest input without deciding {{user}}'s thoughts, dialogue, or choices.";
const agencyMainInstruction = "Continue the current fictional roleplay as {{char}} and the scene narrator, faithfully preserving established characterization, relationships, world rules, and scene continuity while responding directly to {{user}}'s latest input. Follow the permissions in [User Agency].";

export const defaultPromptSettings: PromptSettings = {
  additionalInstruction: '',
  mainInstruction: "Continue the current fictional roleplay as {{char}} and the scene narrator, faithfully preserving established characterization, relationships, world rules, and scene continuity while responding directly to {{user}}'s latest input.",
  groupInstruction: 'Continue the current fictional group roleplay and scene narration, faithfully preserving established characterization, relationships, world rules, and scene continuity.',
  writerInstruction: 'You are one Writer Agent. Use read-only story tools when useful. When no speaker is forced, call select_output_voices exactly once, then continue this same conversation by writing the selected voices in order. Never put tool calls or tool explanations in visible prose.',
  plannerInstruction: 'Plan the next story turn. Read context only when needed, then call submit_turn_plan exactly once. Do not write visible story prose.',
};

export const promptSettingsSchema = z.object({
  additionalInstruction: z.string().max(20_000).default(''),
  mainInstruction: z.string().trim().min(1).max(20_000).default(defaultPromptSettings.mainInstruction).transform(value => value === legacyMainInstruction || value === agencyMainInstruction ? defaultPromptSettings.mainInstruction : value),
  groupInstruction: z.string().trim().min(1).max(20_000).default(defaultPromptSettings.groupInstruction),
  writerInstruction: z.string().trim().min(1).max(20_000).default(defaultPromptSettings.writerInstruction),
  plannerInstruction: z.string().trim().min(1).max(20_000).default(defaultPromptSettings.plannerInstruction),
}).default(defaultPromptSettings);

export const promptPresetInputSchema = z.object({
  name: z.string().trim().min(1, '请输入预设名称。').max(100),
  prompts: promptSettingsSchema.removeDefault(),
});
export const promptPresetPatchSchema = promptPresetInputSchema.partial()
  .refine(value => value.name !== undefined || value.prompts !== undefined, '请提供预设名称或提示词。');
export const promptPresetSchema = promptPresetInputSchema.extend({ id: z.string().min(1) });
export type PromptPreset = z.infer<typeof promptPresetSchema>;
export type PromptPresetInput = z.infer<typeof promptPresetInputSchema>;
export type PromptPresetPatch = z.infer<typeof promptPresetPatchSchema>;

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
  rewriteInstruction: z.string().trim().min(1).max(4_000).optional(),
}).superRefine((value, context) => {
  if (value.trigger === 'normal' && Boolean(value.input) === Boolean(value.targetMessageId)) {
    context.addIssue({ code: 'custom', path: ['input'], message: 'Normal turns require either new input or an existing user message.' });
  }
  if ((value.trigger === 'regenerate' || value.trigger === 'continue') && !value.targetMessageId) {
    context.addIssue({ code: 'custom', path: ['targetMessageId'], message: 'Target message is required.' });
  }
  if (value.rewriteInstruction && value.trigger !== 'regenerate') context.addIssue({ code: 'custom', path: ['rewriteInstruction'], message: 'Rewrite instructions require a target reply.' });
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export const manualMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), head: z.string().nullable(), input: z.object({ voice: userVoiceSchema, text: z.string().trim().min(1).max(100_000) }) }),
  z.object({ role: z.literal('assistant'), head: z.string().nullable(), speaker: speakerRefSchema, text: z.string().trim().min(1).max(100_000) }),
]);
export type ManualMessageInput = z.infer<typeof manualMessageSchema>;

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
  temperature: z.number().min(0).max(2).default(1),
  maxTokens: z.number().int().min(32).max(131_072).default(50_000),
  contextWindow: z.number().int().min(8_192).max(2_000_000).default(1_000_000),
  historyMessageLimit: z.number().int().min(0).max(10_000).default(0),
  reasoning: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).default('high'),
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
  stateTemplate: PersonaStateTemplate;
  avatarPath: string | null;
  legacyPayload?: unknown;
  createdAt: string;
  updatedAt: string;
}

export const personaStateTemplateSchema = z.object({
  gender_age: z.string().max(100_000).default(''),
  appearance: z.string().max(100_000).default(''),
  occupation: z.string().max(100_000).default(''),
  personality: z.string().max(100_000).default(''),
  current_outfit: z.string().max(100_000).default(''),
  past_experience_before_story: z.string().max(100_000).default(''),
  skills: z.array(z.object({
    skill_name: z.string().max(1000).default(''),
    skill_type: z.string().max(1000).default(''),
    skill_level: z.string().max(1000).default(''),
    effect_description: z.string().max(100_000).default(''),
  })).max(100).default([]),
});
export type PersonaStateTemplate = z.infer<typeof personaStateTemplateSchema>;

export const personaInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(100_000).default(''),
  stateTemplate: personaStateTemplateSchema.default(() => ({ gender_age: '', appearance: '', occupation: '', personality: '', current_outfit: '', past_experience_before_story: '', skills: [] })),
  avatarPath: z.string().nullable().default(null),
  legacyPayload: z.unknown().default(null),
});
export type PersonaInput = z.infer<typeof personaInputSchema>;

export interface LoreEntry {
  id: string;
  lorebookId: string;
  title: string;
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
  title: z.string().default(''),
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
  avatarPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export const groupInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  memberIds: z.array(z.string().min(1)).min(1),
  scenario: z.string().max(100_000).default(''),
  avatarPath: z.string().nullable().default(null),
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

export const defaultActionChoicePrompt = '根据当前故事，为用户控制的主角提供可直接发送的下一步行动或对白。各选项应简洁、具体且方向不同，保持人物身份和场景连续性。只提出尚未发生的行动，不续写结果，不把候选当作已经发生的事实。使用与故事相同的语言。';
export const actionChoiceSettingsSchema = z.object({
  count: z.number().int().min(1).max(4).default(4),
  historyMessageLimit: z.number().int().min(0).max(10_000).default(20),
  connectionId: z.string().min(1).nullable().default(null),
  temperature: connectionInputSchema.shape.temperature.nullable().default(null),
  maxTokens: connectionInputSchema.shape.maxTokens.nullable().default(null),
  contextWindow: connectionInputSchema.shape.contextWindow.nullable().default(null),
  reasoning: connectionInputSchema.shape.reasoning.nullable().default(null),
  streaming: z.boolean().nullable().default(null),
  instruction: z.string().trim().min(1).max(20_000).default(defaultActionChoicePrompt),
});
export type ActionChoiceSettings = z.infer<typeof actionChoiceSettingsSchema>;
export const defaultActionChoiceSettings = actionChoiceSettingsSchema.parse({});
export interface ActionChoiceGroup {
  id: string;
  choices: string[];
  createdAt: string;
}
export interface ActionChoiceCache {
  groups: ActionChoiceGroup[];
  selectedGroupId: string | null;
}
export const actionChoiceListSchema = z.array(z.string().trim().min(1).max(4000)).min(1).max(4)
  .refine(choices => new Set(choices.map(text => text.normalize('NFKC').toLocaleLowerCase())).size === choices.length, '行动选项不能重复。');

export const generalSettingsSchema = z.object({
  manualInput: z.boolean().default(false),
  actionChoices: actionChoiceSettingsSchema.default(defaultActionChoiceSettings),
  sendMemory: z.boolean().default(true),
  sendProtagonistState: z.boolean().default(true),
  historyMessageLimit: z.number().int().min(0).max(10_000).default(0),
  connectionId: z.string().min(1).nullable().default(null),
  defaultPersonaId: z.string().min(1).nullable().default(null),
  recordConnectionId: z.string().min(1).nullable().default(null),
  generationMode: generationModeSchema.default('plain'),
  streaming: z.boolean().default(true),
  agencyMode: protagonistAgencyModeSchema.default('protected'),
  agencyPrompts: z.object({
    protected: z.string().trim().min(1).max(20_000).default(defaultAgencyPrompts.protected),
    coauthor: z.string().trim().min(1).max(20_000).default(defaultAgencyPrompts.coauthor),
  }).default(defaultAgencyPrompts),
  narrator: narratorProfileSchema.default({ name: '旁白', avatarPath: null, style: '克制、具象、重视场景连续性，不替角色解释未表达的内心。' }),
  memoryTurnInterval: z.number().int().min(0).max(10_000).default(10),
  stateTurnInterval: z.number().int().min(0).max(10_000).default(0),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export const defaultGeneralSettings: GeneralSettings = generalSettingsSchema.parse({});

export interface Conversation {
  branchGroupId: string | null;
  historyStartMessageId: string | null;
  id: string;
  title: string;
  kind: 'solo' | 'group';
  characterId: string | null;
  groupId: string | null;
  personaId: string | null;
  lorebookIds: string[];
  headMessageId: string | null;
  authorNote: string;
  scenario: string;
  createdAt: string;
  updatedAt: string;
}

export const conversationInputSchema = z.object({
  authorNote: z.string().max(20_000).default(''),
  title: z.string().trim().min(1).max(300),
  kind: z.enum(['solo', 'group']),
  characterId: z.string().nullable().default(null),
  groupId: z.string().nullable().default(null),
  personaId: z.string().nullable().default(null),
  lorebookIds: z.array(z.string()).default([]),
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
  generationInfo?: GenerationInfo | null;
  legacyPayload: unknown;
  createdAt: string;
}

/** Navigation only: content is a short display snippet, never a prompt source. */
export type MessageSummary = Pick<MessageNode, 'id' | 'parentId' | 'role' | 'speaker' | 'content'>;

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoning?: number;
}

export interface RequestTiming {
  preparedAt: string;
  sentAt: string | null;
  headersAt: string | null;
  firstThinkingAt: string | null;
  firstTextAt: string | null;
  completedAt: string | null;
}

export interface GenerationInfo {
  mode: GenerationMode | 'manual';
  model: string;
  streaming: boolean;
  thinking: string | null;
  usage: AgentUsage | null;
  timing: RequestTiming | null;
  requestCount: number;
}

export interface SessionEvent<T = unknown> {
  id: number;
  conversationId: string;
  turnId: string | null;
  type: string;
  payload: T;
  createdAt: string;
}

export interface ContextReportItem {
  titleText?: import('./diagnostics.js').UiText | undefined;
  reasonText?: import('./diagnostics.js').UiText | undefined;
  id: string;
  source: 'system' | 'history' | 'lore' | 'memory' | 'state' | 'control';
  title: string;
  role: 'system' | 'user' | 'assistant';
  included: boolean;
  reason: string;
  estimatedTokens: number;
  messageIds?: string[];
}
export interface ContextReport { items: ContextReportItem[] }

export interface AgentTraceEvent {
  type: string;
  at: string;
  data: unknown;
}

export interface TurnTrace {
  id: string;
  conversationId: string;
  turnId: string;
  phase: 'selection' | 'planning' | 'writing' | 'records' | 'plain' | 'choices';
  requestIndex: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  model: string;
  speaker: SpeakerRef | null;
  request: unknown | null;
  contextReport?: ContextReport | null;
  response: unknown | null;
  tools: Array<{ name: string; arguments: unknown; result?: unknown; ok?: boolean }>;
  events: AgentTraceEvent[];
  thinking: string | null;
  usage: AgentUsage | null;
  timing: RequestTiming | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type TraceSummary = Omit<TurnTrace, 'request' | 'response' | 'contextReport' | 'tools' | 'events' | 'thinking'>;

export interface MemoryCoverage {
  startMessageId: string;
  endMessageId: string;
  storyTurnIds: string[];
}

export interface PinnedFact {
  id: string;
  content: string;
  sourceMessageId: string | null;
  head: string | null;
}

export interface StoryBookmark { id: string; name: string; messageId: string }
export interface StoryNavigation {
  bookmarks: StoryBookmark[];
  scene: { scenario: string; time: string; location: string; importantCharacters: string[] };
}

export interface MemoryEntry {
  id: string;
  conversationId: string;
  stage: number;
  storyTurnId: string | null;
  content: string;
  source: 'generated' | 'imported' | 'manual';
  coverage?: MemoryCoverage | null;
  createdAt: string;
}

export const stateTableNames = [
  'global_state',
  'protagonist_info',
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
  version: 1 | 2;
  tables: ProtagonistTables;
  createdAt: string;
}

export interface InterruptedOutput {
  outputIndex: number;
  speaker: SpeakerRef;
  text: string;
  thinking: string;
}

export interface TurnProgress {
  request: TurnRequest;
  head: string | null;
  parent: string | null;
  oldHead: string | null;
  prefix: string;
  swipe: boolean;
  completedMessageIds: string[];
  interruptedOutputs: InterruptedOutput[];
}

export interface TurnRecord {
  id: string;
  conversationId: string;
  storyTurnId: string;
  status: 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
  trigger: 'normal' | 'regenerate' | 'continue' | 'auto' | 'manual';
  plan: TurnPlan | null;
  progress: TurnProgress | null;
  recordsStatus: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
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
  warningTexts?: Array<import('./diagnostics.js').UiText | null>;
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
  errorText?: import('./diagnostics.js').UiText;
  error: string;
  details?: unknown;
}
export { historyStartIndex } from './history.js';
export { AppError, errorText, uiText, formatUiText, appendWarning, type UiText, type UiDiagnostic } from './diagnostics.js';
