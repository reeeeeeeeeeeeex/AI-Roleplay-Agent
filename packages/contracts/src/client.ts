// Browser-safe shared data: type-only imports do not load the API validators.
import type { ActionChoiceSettings, GeneralSettings, PromptSettings, StateTableName } from './index.js';

export const defaultAgencyPrompts = {
  protected: 'Protected User mode is active. Never invent User’s dialogue, private thoughts, voluntary decisions, consent, or decisive actions. You may describe the world and externally observable consequences. User-authored narration is authoritative and may control User.',
  coauthor: 'Coauthor mode is active. You may write User’s dialogue, thoughts, and actions when it improves the story. User-authored narration remains authoritative.',
};

export const defaultPromptSettings: PromptSettings = {
  additionalInstruction: '',
  mainInstruction: "Continue the current fictional roleplay as {{char}} and the scene narrator, faithfully preserving established characterization, relationships, world rules, and scene continuity while responding directly to {{user}}'s latest input.",
  groupInstruction: 'Continue the current fictional group roleplay and scene narration, faithfully preserving established characterization, relationships, world rules, and scene continuity.',
  writerInstruction: 'You are one Writer Agent. Use read-only story tools when useful. When no speaker is forced, call select_output_voices exactly once, then continue this same conversation by writing the selected voices in order. Never put tool calls or tool explanations in visible prose.',
  plannerInstruction: 'Plan the next story turn. Read context only when needed, then call submit_turn_plan exactly once. Do not write visible story prose.',
};

export const defaultActionChoicePrompt = '根据当前故事，为用户控制的主角提供可直接发送的下一步行动或对白。各选项应简洁、具体且方向不同，保持人物身份和场景连续性。只提出尚未发生的行动，不续写结果，不把候选当作已经发生的事实。使用与故事相同的语言。';

export const defaultActionChoiceSettings: ActionChoiceSettings = {
  count: 4, historyMessageLimit: 20, connectionId: null, temperature: null, maxTokens: null,
  contextWindow: null, reasoning: null, streaming: null, instruction: defaultActionChoicePrompt,
};

export const defaultGeneralSettings: GeneralSettings = {
  manualInput: false, actionChoices: { ...defaultActionChoiceSettings }, sendMemory: true, sendProtagonistState: true,
  historyMessageLimit: 0, connectionId: null, defaultPersonaId: null, recordConnectionId: null,
  generationMode: 'plain', streaming: true, agencyMode: 'protected', agencyPrompts: { ...defaultAgencyPrompts },
  narrator: { name: '旁白', avatarPath: null, style: '克制、具象、重视场景连续性，不替角色解释未表达的内心。' },
  memoryTurnInterval: 10, stateTurnInterval: 0,
};

// Public data columns retained for interoperable snapshots; executor is implemented independently.
export const stateColumns: Record<StateTableName, string[]> = {
  global_state: ['current_location', 'current_time', 'previous_scene_time', 'elapsed_time'],
  protagonist_info: ['character_name', 'gender_age', 'appearance', 'occupation', 'personality', 'current_outfit', 'past_experience_before_story', 'past_experience_in_story'],
  important_characters: ['name', 'gender_age', 'brief_introduction', 'appearance', 'key_items', 'is_dead', 'past_experience'],
  protagonist_skills: ['skill_name', 'skill_type', 'skill_level', 'effect_description'],
  inventory: ['item_name', 'quantity', 'description', 'category'],
  quests_events: ['quest_name', 'quest_type', 'issuer', 'detail_description', 'current_progress', 'time_limit', 'reward', 'penalty'],
};
export { historyStartIndex } from './history.js';
export { formatUiText, type UiText } from './diagnostics.js';
