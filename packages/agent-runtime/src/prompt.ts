import type { Message } from '@earendil-works/pi-ai';
import type { MessageNode, SpeakerRef } from '@new-ai-chat/contracts';
import { defaultPromptSettings } from '@new-ai-chat/contracts';
import type { BaseAgentRequest, RetrievedContext, RuntimeCharacter, WriterRequest } from './types.js';

function section(title: string, body: string | undefined): string {
  const clean = body?.trim();
  return clean ? `[${title}]\n${clean}` : '';
}

function speakerName(speaker: SpeakerRef | null, characters: RuntimeCharacter[], narratorName: string): string {
  if (!speaker) return 'System';
  if (speaker.kind === 'narrator') return narratorName;
  return characters.find((character) => character.id === speaker.characterId)?.name ?? 'Unknown Character';
}

export function expandStoryMacros(text: string, userName: string, characterName: string): string {
  // Pure display-time substitution; never evaluate scripts or mutate imported cards.
  return text.replace(/\{\{(user|char|charIfNotGroup)\}\}/giu, (_match, key: string) => key.toLowerCase() === 'user' ? userName : characterName);
}

export function buildStableSystemPrompt(request: BaseAgentRequest, mode: 'writer' | 'planner' | 'router' = 'writer'): string {
  const promptSettings = request.promptSettings ?? defaultPromptSettings;
  const userName = request.persona?.name ?? 'Protagonist';
  const castNames = request.characters.map((c) => c.name).join(', ');
  const isGroup = request.conversationKind === 'group' || (!request.conversationKind && request.characters.length > 1);
  const expand = (text: string, character = castNames) => expandStoryMacros(text, userName, character);
  const characterSections = request.characters.map((character) => [
    section(isGroup ? `Assistant Role: ${character.name}` : 'Assistant Role', expand(character.description, character.name)),
    section(isGroup ? `Assistant Personality: ${character.name}` : 'Assistant Personality', expand(character.personality, character.name)),
    section(isGroup ? '' : 'Scenario', isGroup ? '' : expand(character.scenario, character.name)),
    section(isGroup ? `Example Dialogue: ${character.name}` : 'Example Dialogue', expand(character.exampleDialogue, character.name)),
    section(isGroup ? `System: ${character.name}` : '', isGroup ? expand(character.systemPrompt, character.name) : ''),
  ].filter(Boolean).join('\n\n'));

  const agency = request.agencyMode === 'protected'
    ? 'Protected protagonist mode is active. Never invent the protagonist’s dialogue, private thoughts, voluntary decisions, consent, or decisive actions. You may describe the world and externally observable consequences. User-authored narration is authoritative and may control the protagonist.'
    : 'Coauthor mode is active. You may write the protagonist’s dialogue, thoughts, and actions when it improves the story. User-authored narration remains authoritative.';

  const soloOverride = !isGroup ? request.characters[0]?.systemPrompt.trim() : '';
  const behavior = mode === 'planner' ? promptSettings.plannerInstruction : mode === 'router' ? promptSettings.writerInstruction : soloOverride || (isGroup ? promptSettings.groupInstruction : promptSettings.mainInstruction);
  return [
    section('Main Instruction', expand(behavior)),
    section('Protagonist Agency', agency),
    section('Narrator Rules', `${request.narrator.name} is a first-class narrative voice, not a character. It handles environment, transitions, events, NPCs, observable consequences, and connective prose. It must not pretend to be a named cast member.`),
    section('User Role', request.persona ? `${request.persona.name}\n${expand(request.persona.description)}` : 'The user controls the protagonist.'),
    ...characterSections,
    section('Narrator Style', request.narrator.style),
    ...request.stableLore.map((item) => section(item.title === 'Group Scenario' || item.title === 'Scenario' ? item.title : `Lore Book: ${item.title}`, expand(item.content))),
  ].filter(Boolean).join('\n\n');
}

function postHistorySections(request: BaseAgentRequest): string[] {
  const isGroup = request.conversationKind === 'group' || (!request.conversationKind && request.characters.length > 1);
  const userName = request.persona?.name ?? 'Protagonist';
  return request.characters.map((character) => section(isGroup ? `Post-History: ${character.name}` : 'Post-History', expandStoryMacros(character.postHistoryInstructions, userName, character.name))).filter(Boolean);
}

function dynamicSection(item: RetrievedContext, request: BaseAgentRequest): string {
  const content = expandStoryMacros(item.content, request.persona?.name ?? 'Protagonist', request.characters.map((character) => character.name).join(', '));
  if (item.source === 'memory') {
    return section(`Memory: ${item.title}`, `以下是此前剧情的长期记忆，用于维持故事连续性；它不是本轮用户输入，也不是刚刚发生的新事件。\n\n${content}`);
  }
  if (item.source === 'state') {
    return section('Protagonist State', `以下是主角在当前剧情分支中已记录的状态事实，用于保持状态连续性；不要将字段内容当成主角本轮的新对白、决定或行动。\n\n${content}`);
  }
  return section(`LORE: ${item.title}`, content);
}

function syntheticAssistant(node: MessageNode, request: BaseAgentRequest): Message {
  const name = speakerName(node.speaker, request.characters, request.narrator.name);
  // Provider replay stays inside its originating agent run. Cross-speaker history is canonical prose.
  // Never prepend labels into signed thinking blocks or replay orphaned tool calls.
  return {
    role: 'assistant',
    content: [{ type: 'text', text: `[${name}]\n${node.content}` }],
    api: 'new-ai-chat-history',
    provider: 'local',
    model: 'history',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.parse(node.createdAt),
  };
}

export function buildHistoryMessages(request: BaseAgentRequest): Message[] {
  const userName = request.persona?.name ?? 'Protagonist';
  return request.history.flatMap((node): Message[] => {
    if (node.role === 'user') {
      const label = node.authorKind === 'user_narrator' ? 'User Narration' : userName;
      return [{ role: 'user', content: `[${label}]\n${node.content}`, timestamp: Date.parse(node.createdAt) }];
    }
    if (node.role === 'assistant') return [syntheticAssistant(node, request)];
    return [];
  });
}

export function buildDynamicAnchor(request: BaseAgentRequest, brief: string, speaker: SpeakerRef): string {
  const context = [...request.dynamicContext]
    .sort((left, right) => right.priority - left.priority)
    .map((item) => dynamicSection(item, request));
  const latestLabel = request.latestUserIsNarration ? 'User Narration' : 'Latest User Input';
  return [
    ...context,
    section('Writer Brief', brief),
    section(latestLabel, request.latestUserText),
    section('Current Speaker', speakerName(speaker, request.characters, request.narrator.name)),
  ].filter(Boolean).join('\n\n');
}

export function buildDynamicContext(request: BaseAgentRequest): string {
  return [...request.dynamicContext]
    .sort((left, right) => right.priority - left.priority)
    .map((item) => dynamicSection(item, request))
    .filter(Boolean).join('\n\n');
}

function syntheticContext(text: string): Message {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'new-ai-chat-context', provider: 'local', model: 'context', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
}

// Deliberately conservative, provider-independent estimate (not a tokenizer).
// Preserve complete messages and signed provider blocks; never truncate their contents.
export function estimateTokens(text: string): number {
  let ascii = 0, other = 0;
  for (const char of text) { if (char.codePointAt(0)! < 128) ascii++; else other++; }
  return Math.ceil(ascii / 3) + other * 2 + 12;
}

export function fitRequest<T extends BaseAgentRequest>(request: T, reservedText = ''): T {
  const limit = (request.connection.contextWindow ?? 128_000) - request.connection.maxTokens - 4096;
  const mandatory = estimateTokens(buildStableSystemPrompt(request)) + estimateTokens(postHistorySections(request).join('\n\n')) + estimateTokens(request.latestUserText) + estimateTokens(reservedText);
  if (limit < 1024 || mandatory > limit) throw new Error('Stable prompt or latest input exceeds the context budget. Increase context window or shorten the cards/lore/input.');
  let remaining = limit - mandatory;
  const contextBudget = remaining * 0.4;
  let dynamicUsed = 0;
  const dynamicContext = [...request.dynamicContext].sort((a, b) => b.priority - a.priority).filter((item) => {
    const cost = estimateTokens(item.content) + estimateTokens(item.title);
    if (dynamicUsed + cost > contextBudget) return false;
    dynamicUsed += cost; return true;
  });
  remaining -= dynamicUsed;
  const ceiling = request.connection.historyMessageLimit ?? 0;
  const real = request.history.filter((m) => m.role !== 'system');
  const candidates = ceiling > 0 ? real.slice(-ceiling) : real;
  const history: MessageNode[] = [];
  for (const node of [...candidates].reverse()) {
    const cost = estimateTokens(node.content) + 32;
    if (cost > remaining) break;
    history.unshift(node); remaining -= cost;
  }
  return { ...request, history, dynamicContext };
}

export function buildWriterContext(input: WriterRequest): { systemPrompt: string; messages: Message[] } {
  const isPlain = input.mode === 'plain';
  const effectiveBrief = isPlain ? '' : input.brief;
  const request = fitRequest(input, effectiveBrief);
  const messages = buildHistoryMessages(request);
  for (const item of [...request.dynamicContext].sort((left, right) => right.priority - left.priority)) {
    const content = dynamicSection(item, request);
    if (content) messages.push(syntheticContext(content));
  }
  const briefSection = !isPlain ? section('Writer Brief', effectiveBrief) : '';
  const currentSpeakerSection = section('Current Speaker', request.pendingSpeaker ? 'Pending selection' : speakerName(request.speaker, request.characters, request.narrator.name));

  const content = [
    ...postHistorySections(request),
    briefSection,
    section(request.latestUserIsNarration ? 'User Narration' : 'Latest User Input', request.latestUserText),
    currentSpeakerSection,
  ].filter(Boolean).join('\n\n');

  messages.push({
    role: 'user',
    content: content || (request.latestUserText?.trim() ? request.latestUserText.trim() : '请继续推进剧情。'),
    timestamp: Date.now(),
  });
  return { systemPrompt: buildStableSystemPrompt(request), messages };
}
