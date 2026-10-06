import { describe, expect, it } from 'vitest';
import { defaultAgencyPrompts, defaultPromptSettings, promptSettingsSchema, type MessageNode } from '@new-ai-chat/contracts';
import { buildStableSystemPrompt, buildWriterContext, fitRequest } from './prompt.js';

const base = {
  connection: { id: 'c', protocol: 'openai-responses' as const, baseUrl: 'https://example.test/v1', model: 'm', apiKey: '', headers: {}, temperature: 1, maxTokens: 1000, reasoning: 'off' as const },
  conversationKind: 'solo' as const, scenario: '', streaming: true, storyTurnId: 's', conversationId: 'chat', agencyMode: 'protected' as const,
  narrator: { name: '旁白', style: '冷静' },
  characters: [{ id: 'a', name: 'A', description: '{{char}} greets {{user}}.', personality: 'calm', scenario: 'card scene', exampleDialogue: 'hello', systemPrompt: '', postHistoryInstructions: 'stay concise' }],
  persona: { name: 'P', description: 'persona' }, history: [] as MessageNode[], stableLore: [{ source: 'lore' as const, title: 'World', content: 'fixed', priority: 1 }],
  dynamicContext: [{ source: 'lore' as const, title: 'Door', content: 'dynamic lore', priority: 2 }, { source: 'memory' as const, title: 'Stage 1', content: 'past', priority: 1 }],
  latestUserText: '我推开门。', latestUserIsNarration: false, source: {} as never, signal: new AbortController().signal,
};

describe('ReST prompt assembly', () => {
  it('none agency omits control and migrates only the built-in main instruction', () => {
    const previousDefault = `${defaultPromptSettings.mainInstruction} Follow the permissions in [User Agency].`;
    const promptSettings = promptSettingsSchema.parse({ mainInstruction: previousDefault });
    const prompt = buildStableSystemPrompt({ ...base, agencyMode: 'none', promptSettings });
    expect(prompt).not.toContain('[User Agency]');
    expect(prompt).not.toContain(defaultAgencyPrompts.protected);
    expect(prompt).not.toContain(defaultAgencyPrompts.coauthor);
    expect(prompt).toContain('[User Role]');
    expect(promptSettingsSchema.parse({ mainInstruction: `Custom rules. ${previousDefault}` }).mainInstruction).toBe(`Custom rules. ${previousDefault}`);
  });

  it('rejects Memory budget overflow instead of sending only newer stages', () => {
    const memory = { source: 'memory' as const, content: 'past '.repeat(1000) };
    const request = { ...base, dynamicContext: [
      { ...memory, title: 'Stage 1', priority: 100.000001 },
      { ...memory, title: 'Stage 2', priority: 100.000002 },
    ] };
    expect(() => fitRequest({ ...request, connection: { ...request.connection, contextWindow: 12000 } }))
      .toThrow(/Memory 上下文预算不足.*输入估算 \d+、最大输出 1000、配置窗口 12000.*请增大上下文窗口/u);
  });

  it('keeps fixed history intact instead of silently sliding on token overflow', () => {
    const node: MessageNode = { id: 'start', conversationId: 'chat', parentId: null, storyTurnId: null, role: 'user', authorKind: 'protagonist', speaker: null, content: '固定起点。', providerState: null, legacyPayload: null, createdAt: '' };
    const request = { ...base, fixedHistory: true, connection: { ...base.connection, historyMessageLimit: 1 }, history: [node, { ...node, id: 'last', content: '后续消息。' }] };
    expect(fitRequest(request).history).toEqual(request.history);
    expect(() => fitRequest({ ...request, history: [{ ...node, content: '长篇剧情'.repeat(100_000) }] })).toThrow('固定发送范围超过上下文预算');
  });
  it('keeps the stable prefix, group order, dynamic records and final controls in their documented positions', () => {
    const solo = buildStableSystemPrompt(base);
    expect(defaultPromptSettings.mainInstruction).toContain('Continue the current fictional roleplay as {{char}}');
    expect(solo).toContain('Continue the current fictional roleplay as A');
    expect(solo).toContain('[Assistant Role: A]\nA greets P.');
    expect(solo.indexOf('[User Agency]')).toBeLessThan(solo.indexOf('[Assistant Role: A]'));
    expect(solo).toContain(defaultAgencyPrompts.protected);
    expect(solo).toContain('User is the role played by the human user. Assistant represents the cast and scene narrator.\nUser name: P');
    const override = buildStableSystemPrompt({ ...base, promptSettings: { ...defaultPromptSettings, additionalInstruction: 'Extra guidance for {{user}} and {{char}}.' }, characters: [{ ...base.characters[0]!, systemPrompt: 'Character override for {{char}}.' }] });
    expect(override).toContain('[Main Instruction]\nCharacter override for A.');
    expect(override).toContain('[Additional Instruction]\nExtra guidance for P and A.');
    expect(override.indexOf('[Additional Instruction]')).toBeLessThan(override.indexOf('[Lore Book: World]'));
    expect(solo).not.toContain('[Additional Instruction]');

    const groupCharacters = [base.characters[0]!, { ...base.characters[0]!, id: 'b', name: 'B', description: 'second', scenario: 'must not appear' }];
    const group = buildStableSystemPrompt({ ...base, conversationKind: 'group', characters: groupCharacters, stableLore: [{ source: 'lore', title: 'Group Scenario', content: 'shared scene', priority: 1 }] });
    expect(group).toContain(defaultPromptSettings.groupInstruction);
    expect(group.indexOf('[Assistant Role: A]')).toBeLessThan(group.indexOf('[Assistant Role: B]'));
    expect(group).toContain('[Group Scenario]\nshared scene'); expect(group).not.toContain('must not appear');

    const history: MessageNode[] = [{ id: 'u', conversationId: 'chat', parentId: null, storyTurnId: 's', role: 'user', authorKind: 'protagonist', speaker: null, content: 'history', providerState: null, legacyPayload: null, createdAt: new Date().toISOString() }];
    const writer = buildWriterContext({ ...base, history, speaker: { kind: 'narrator' }, outputIndex: 0, brief: '', pendingSpeaker: false });
    expect(writer.systemPrompt).toContain('[Assistant Role: A]\nA greets P.');
    expect(writer.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'user']);
    expect(String(writer.messages[0]?.content)).toContain('[P]\nhistory');
    const final = String(writer.messages.at(-1)?.content);
    expect(final.indexOf('[Post-History]')).toBeLessThan(final.indexOf('[Latest User Input]'));
    expect(final.indexOf('[Latest User Input]')).toBeLessThan(final.indexOf('[Current Speaker]'));
  });

  it('uses the edited prompt for the selected User agency mode in writing and planning', () => {
    const agencyPrompts = { protected: 'Wait for {{user}} to decide; {{char}} reacts.', coauthor: 'Collaborate on {{user}}’s actions.' };
    const writing = buildStableSystemPrompt({ ...base, agencyPrompts });
    expect(writing).toContain('[User Agency]\nWait for P to decide; A reacts.');
    expect(writing).not.toContain(agencyPrompts.coauthor);
    const planning = buildStableSystemPrompt({ ...base, agencyPrompts, agencyMode: 'coauthor', persona: null }, 'planner');
    expect(planning).toContain('[User Agency]\nCollaborate on User’s actions.');
    expect(planning).not.toContain('Wait for');
    expect(planning).not.toMatch(/\bprotagonist\b/iu);
  });

  it('omits writer brief and automatic speaker in plain mode, and formats memory and state with guidance', () => {
    const history: MessageNode[] = [{ id: 'u', conversationId: 'chat', parentId: null, storyTurnId: 's', role: 'user', authorKind: 'protagonist', speaker: null, content: 'history', providerState: null, legacyPayload: null, createdAt: new Date().toISOString() }];
    const plain = buildWriterContext({
      ...base,
      authorNote: 'Keep {{char}} cautious around {{user}}.',
      history,
      dynamicContext: [
        { source: 'state', title: 'Protagonist State', content: 'HP: 100', priority: 3 },
        { source: 'memory', title: 'Chapter 1', content: 'old events', priority: 2 },
      ],
      speaker: { kind: 'character', characterId: 'a' },
      outputIndex: 0,
      brief: '待选择回复身份',
      pendingSpeaker: false,
      mode: 'plain',
    });

    const textOf = (msg: any) => typeof msg?.content === 'string' ? msg.content : (msg?.content ?? []).map((p: any) => p.text ?? '').join('');

    const stateMsg = textOf(plain.messages[1]);
    expect(stateMsg).toContain('[User State]\n以下是 User（用户扮演的主角）在当前剧情分支中已记录的状态事实');
    expect(stateMsg).toContain('HP: 100');
    expect(stateMsg).toContain('is_dead means confirmed death only');
    expect(stateMsg).toContain('absence, disappearance, or being off-screen is not evidence of death');

    const memoryMsg = textOf(plain.messages[2]);
    expect(memoryMsg).toContain('[Memory: Chapter 1]\n以下是此前剧情的长期记忆');
    expect(memoryMsg).toContain('old events');

    const finalPlain = textOf(plain.messages.at(-1));
    expect(finalPlain).toContain('[Latest User Input]\n以下是用户本轮输入：\n“我推开门。”');
    expect(finalPlain).not.toContain('[Writer Brief]');
    expect(finalPlain).toContain('[Current Speaker]\nA');
    expect(plain.messages.at(-2)).toMatchObject({ authorNote: true, content: "[Author's Note]\nKeep A cautious around P." });
    expect(plain.contextReport.items.find(item => item.id === 'author-note')).toMatchObject({ role: 'system', included: true });
    expect(plain.systemPrompt).toBe(buildStableSystemPrompt(base));
    expect(() => fitRequest({ ...base, authorNote: '必须保留'.repeat(20000) })).toThrow('context budget');
  });
});
