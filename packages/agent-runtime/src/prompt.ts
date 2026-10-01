import type { Message } from '@earendil-works/pi-ai';
import type { MessageNode, SpeakerRef, ContextReport, ContextReportItem } from '@new-ai-chat/contracts';
import { defaultPromptSettings, stateDeathInstruction } from '@new-ai-chat/contracts';
import type { BaseAgentRequest, RetrievedContext, RuntimeCharacter, WriterRequest } from './types.js';
import { authorNoteInFirstSystem } from './author-note.js';

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

export function buildStableSystemPrompt(request: BaseAgentRequest, mode: 'writer' | 'planner' | 'router' | 'choices' = 'writer'): string {
  const promptSettings = request.promptSettings ?? defaultPromptSettings;
  const userName = request.persona?.name ?? 'Protagonist';
  const castNames = request.characters.map((c) => c.name).join(', ');
  const isGroup = request.conversationKind === 'group' || (!request.conversationKind && request.characters.length > 1);
  const expand = (text: string, character = castNames) => expandStoryMacros(text, userName, character);
  if (mode === 'choices') return [
    section('Action Choices', expand(promptSettings.mainInstruction)),
    section('User Role', request.persona ? `${request.persona.name}\n${expand(request.persona.description)}` : 'The user controls the protagonist.'),
    ...request.characters.flatMap(character => [
      section(`Assistant Role: ${character.name}`, expand(character.description, character.name)),
      section(`Assistant Personality: ${character.name}`, expand(character.personality, character.name)),
      section('Scenario', expand(character.scenario, character.name)),
    ]),
    ...request.stableLore.map(item => section(item.title, expand(item.content))),
    section('Additional Instruction', expand(promptSettings.additionalInstruction)),
  ].filter(Boolean).join('\n\n');
  const characterSections = request.characters.map((character) => [
    section(`Assistant Role: ${character.name}`, expand(character.description, character.name)),
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
    section('Additional Instruction', expand(promptSettings.additionalInstruction ?? '')),
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
    if (item.required) return section('Pinned Fact', `以下是用户在当前分支固定的事实；自动摘要不能改写它。它不是新事件，也不授予代替主角行动的权限。\n\n${content}`);
    return section(`Memory: ${item.title}`, `以下是此前剧情的长期记忆，用于维持故事连续性；它不是本轮用户输入，也不是刚刚发生的新事件。\n\n${content}`);
  }
  if (item.source === 'state') {
    return section('Protagonist State', `以下是主角在当前剧情分支中已记录的状态事实，用于保持状态连续性；不要将字段内容当成主角本轮的新对白、决定或行动。\n${stateDeathInstruction}\n\n${content}`);
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
  const context = orderedDynamicContext(request.dynamicContext)
    .map((item) => dynamicSection(item, request));
  return [
    ...context,
    section('Writer Brief', brief),
    latestUserAnchor(request),
    section('Current Speaker', speakerName(speaker, request.characters, request.narrator.name)),
  ].filter(Boolean).join('\n\n');
}

export function buildDynamicContext(request: BaseAgentRequest): string {
  return orderedDynamicContext(request.dynamicContext)
    .map((item) => dynamicSection(item, request))
    .filter(Boolean).join('\n\n');
}

function orderedDynamicContext(items: RetrievedContext[]): RetrievedContext[] {
  const ordered = [...items].sort((a, b) => b.priority - a.priority);
  const isMemory = (item: RetrievedContext) => item.source === 'memory' && !item.required;
  // Newer stages retain higher budget priority, but are sent after older memories.
  const memories = ordered.filter(isMemory).sort((a, b) => a.priority - b.priority);
  let index = 0;
  return ordered.map(item => isMemory(item) ? memories[index++]! : item);
}

export function latestUserAnchor(request: BaseAgentRequest): string {
  if (!request.latestUserText.trim()) return '';
  return section(request.latestUserIsNarration ? 'User Narration' : 'Latest User Input', `以下是用户本轮输入：\n“${request.latestUserText}”`);
}

function syntheticContext(text: string): Message {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'new-ai-chat-context', provider: 'local', model: 'context', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
}

export function buildActionChoiceContext(request: BaseAgentRequest, control: string) {
  const messages = buildHistoryMessages(request);
  const dynamic = buildDynamicContext(request);
  if (dynamic) messages.push(syntheticContext(dynamic));
  messages.push(...buildAuthorNoteMessages(request), { role: 'user', content: control, timestamp: Date.now() });
  return { systemPrompt: buildStableSystemPrompt(request, 'choices'), messages };
}

export function buildAuthorNoteMessages(request: BaseAgentRequest): Message[] {
  const content = section("Author's Note", expandStoryMacros(request.authorNote ?? '', request.persona?.name ?? 'Protagonist', request.characters.map(character => character.name).join(', ')));
  // Pi only models user/assistant/tool messages. The gateway restores the System role
  // before sending, keeping this instruction after history where the protocol allows it.
  const message = { role: 'user' as const, content, timestamp: 0, authorNote: true };
  return content ? [message] : [];
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
  const pinned = request.dynamicContext.filter(item => item.required);
  const authorNote = buildAuthorNoteMessages(request)[0];
  const mandatory = estimateTokens(buildStableSystemPrompt(request, request.promptMode ?? 'writer')) + (authorNote ? estimateTokens(String(authorNote.content)) + 32 : 0) + estimateTokens(postHistorySections(request).join('\n\n')) + estimateTokens(latestUserAnchor(request)) + estimateTokens(reservedText) + pinned.reduce((sum, item) => sum + estimateTokens(dynamicSection(item, request)), 0);
  if (limit < 1024 || mandatory > limit) throw new Error('Stable prompt or latest input exceeds the context budget. Increase context window or shorten the cards/lore/input.');
  let remaining = limit - mandatory;
  const contextBudget = remaining * 0.4;
  const ceiling = request.fixedHistory ? 0 : request.connection.historyMessageLimit ?? 0;
  const real = request.history.filter((m) => m.role !== 'system');
  const candidates = ceiling > 0 ? real.slice(-ceiling) : real;
  const optional = request.dynamicContext.filter(item => !item.required).sort((a, b) => b.priority - a.priority);
  let dynamicUsed = 0;
  const dynamicContext = [...pinned, ...optional.filter((item) => {
    const cost = estimateTokens(dynamicSection(item, request));
    if (dynamicUsed + cost > contextBudget) {
      if (item.source === 'memory') {
        const inputEstimate = mandatory + optional.reduce((sum, entry) => sum + estimateTokens(dynamicSection(entry, request)), 0) + candidates.reduce((sum, node) => sum + estimateTokens(node.content) + 32, 0);
        throw new Error(`Memory 上下文预算不足，无法完整发送已选记忆：资料预算估算 ${Math.floor(contextBudget)} token；输入估算 ${inputEstimate}、最大输出 ${request.connection.maxTokens}、配置窗口 ${request.connection.contextWindow ?? 128_000} token。请增大上下文窗口、调低最大输出，或关闭 Memory 发送后重试。`);
      }
      return false;
    }
    dynamicUsed += cost; return true;
  })];
  remaining -= dynamicUsed;
  const history: MessageNode[] = [];
  for (const node of [...candidates].reverse()) {
    const cost = estimateTokens(node.content) + 32;
    if (cost > remaining) {
      if (request.fixedHistory) throw new Error('固定发送范围超过上下文预算，请向后调整发送起点、减少资料或增大上下文窗口。为保留固定前缀，未自动裁剪历史。');
      break;
    }
    history.unshift(node); remaining -= cost;
  }
  const items: ContextReportItem[] = [
    { id: 'system', source: 'system', title: request.promptMode === 'choices' ? '行动选项指令与身份' : '固定指令、身份与主角权限', role: 'system', included: true, reason: '固定前缀', estimatedTokens: estimateTokens(buildStableSystemPrompt({ ...request, stableLore: [] }, request.promptMode ?? 'writer')) },
    ...request.stableLore.map(item => ({ id: item.sourceId ?? item.title, source: 'lore' as const, title: item.title, role: 'system' as const, included: true, reason: '常驻资料', estimatedTokens: estimateTokens(item.content) })),
    ...real.map(node => ({ id: node.id, source: 'history' as const, title: `${node.role} · ${node.id.slice(0, 8)}`, role: node.role, included: history.includes(node), reason: history.includes(node) ? '当前分支' : candidates.includes(node) ? '上下文预算' : '历史消息上限', estimatedTokens: estimateTokens(node.content) + 32, messageIds: [node.id] })),
    ...orderedDynamicContext(request.dynamicContext).map(item => ({ id: item.sourceId ?? item.title, source: item.source, title: item.title, role: 'assistant' as const, included: dynamicContext.includes(item), reason: !dynamicContext.includes(item) ? '上下文预算' : item.required ? '用户固定事实' : '动态资料', estimatedTokens: estimateTokens(dynamicSection(item, request)), messageIds: item.messageIds ?? [] })),
  ];
  const keys = new Set(items.map(item => `${item.source}:${item.id}`));
  if (authorNote) items.push({ id: 'author-note', source: 'control', title: '作者注释', role: 'system', included: true, reason: authorNoteInFirstSystem(request.connection) ? 'DeepSeek：合并到首条 System；修改注释会影响后续前缀缓存' : request.connection.protocol === 'anthropic-messages' ? '协议要求：顶层 System' : '历史后部 · Depth 0', estimatedTokens: estimateTokens(String(authorNote.content)) + 32 });
  items.push(...(request.contextReport?.items ?? []).filter(item => !item.included && !keys.has(`${item.source}:${item.id}`)));
  return { ...request, history, dynamicContext, contextReport: { items } };
}

export function buildWriterContext(input: WriterRequest): { systemPrompt: string; messages: Message[]; contextReport: ContextReport } {
  const isPlain = input.mode === 'plain';
  const effectiveBrief = isPlain ? '' : input.brief;
  const rewriteControl = input.rewrite ? [
    section('Rewrite Source', input.rewrite.originalText),
    section('Rewrite Instruction', `The following is a one-time editing direction, not an event or a fact in the story. Replace the source reply in full, preserving the assigned speaker and all protagonist agency constraints. Output only the rewritten prose.\n${input.rewrite.instruction}`),
  ].join('\n\n') : '';
  const request = fitRequest(input, `${effectiveBrief}\n${rewriteControl}`);
  const messages = buildHistoryMessages(request);
  for (const item of orderedDynamicContext(request.dynamicContext)) {
    const content = dynamicSection(item, request);
    if (content) messages.push(syntheticContext(content));
  }
  messages.push(...buildAuthorNoteMessages(request));
  const briefSection = !isPlain ? section('Writer Brief', effectiveBrief) : '';
  const currentSpeakerSection = section('Current Speaker', request.pendingSpeaker ? 'Pending selection' : speakerName(request.speaker, request.characters, request.narrator.name));

  const content = [
    ...postHistorySections(request),
    briefSection,
    rewriteControl,
    request.continuation ? section('Continue Writing', 'Continue directly from the end of the selected assistant reply in the history. Output only the new continuation; do not repeat existing text, restart the scene, or change the speaker. All protagonist agency and narrator constraints still apply.') : '',
    latestUserAnchor(request),
    currentSpeakerSection,
  ].filter(Boolean).join('\n\n');

  messages.push({
    role: 'user',
    content: content || (request.latestUserText?.trim() ? request.latestUserText.trim() : '请继续推进剧情。'),
    timestamp: Date.now(),
  });
  const contextReport: ContextReport = { items: [...request.contextReport!.items, { id: 'writer-control', source: 'control', title: '后置指令、最新用户输入与 Current Speaker', role: 'user', included: true, reason: '最后的写作控制', estimatedTokens: estimateTokens(content) }] };
  return { systemPrompt: buildStableSystemPrompt(request), messages, contextReport };
}
