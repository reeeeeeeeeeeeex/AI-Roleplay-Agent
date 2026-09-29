import { describe, expect, it } from 'vitest';
import { defaultPromptSettings, type MessageNode } from '@new-ai-chat/contracts';
import { buildStableSystemPrompt, buildWriterContext } from './prompt.js';

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
  it('keeps the stable prefix, group order, dynamic records and final controls in their documented positions', () => {
    const solo = buildStableSystemPrompt(base);
    expect(defaultPromptSettings.mainInstruction).toContain('Continue the current fictional roleplay as {{char}}');
    expect(solo).toContain('Continue the current fictional roleplay as A');
    expect(solo).toContain('[Assistant Role: A]\nA greets P.');
    expect(solo.indexOf('[Protagonist Agency]')).toBeLessThan(solo.indexOf('[Assistant Role: A]'));
    const override = buildStableSystemPrompt({ ...base, characters: [{ ...base.characters[0]!, systemPrompt: 'Character override for {{char}}.' }] });
    expect(override).toContain('[Main Instruction]\nCharacter override for A.');

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

  it('omits writer brief and automatic speaker in plain mode, and formats memory and state with guidance', () => {
    const history: MessageNode[] = [{ id: 'u', conversationId: 'chat', parentId: null, storyTurnId: 's', role: 'user', authorKind: 'protagonist', speaker: null, content: 'history', providerState: null, legacyPayload: null, createdAt: new Date().toISOString() }];
    const plain = buildWriterContext({
      ...base,
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
    expect(stateMsg).toContain('[Protagonist State]\n以下是主角在当前剧情分支中已记录的状态事实');
    expect(stateMsg).toContain('HP: 100');

    const memoryMsg = textOf(plain.messages[2]);
    expect(memoryMsg).toContain('[Memory: Chapter 1]\n以下是此前剧情的长期记忆');
    expect(memoryMsg).toContain('old events');

    const finalPlain = textOf(plain.messages.at(-1));
    expect(finalPlain).toContain('[Latest User Input]\n以下是用户本轮输入：\n“我推开门。”');
    expect(finalPlain).not.toContain('[Writer Brief]');
    expect(finalPlain).toContain('[Current Speaker]\nA');
  });
});
