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
    expect(solo).toContain('[Assistant Role]\nA greets P.');
    expect(solo.indexOf('[Protagonist Agency]')).toBeLessThan(solo.indexOf('[Assistant Role]'));
    const override = buildStableSystemPrompt({ ...base, characters: [{ ...base.characters[0]!, systemPrompt: 'Character override for {{char}}.' }] });
    expect(override).toContain('[Main Instruction]\nCharacter override for A.');

    const groupCharacters = [base.characters[0]!, { ...base.characters[0]!, id: 'b', name: 'B', description: 'second', scenario: 'must not appear' }];
    const group = buildStableSystemPrompt({ ...base, conversationKind: 'group', characters: groupCharacters, stableLore: [{ source: 'lore', title: 'Group Scenario', content: 'shared scene', priority: 1 }] });
    expect(group).toContain(defaultPromptSettings.groupInstruction);
    expect(group.indexOf('[Assistant Role: A]')).toBeLessThan(group.indexOf('[Assistant Role: B]'));
    expect(group).toContain('[Group Scenario]\nshared scene'); expect(group).not.toContain('must not appear');

    const history: MessageNode[] = [{ id: 'u', conversationId: 'chat', parentId: null, storyTurnId: 's', role: 'user', authorKind: 'protagonist', speaker: null, content: 'history', providerState: null, legacyPayload: null, createdAt: new Date().toISOString() }];
    const writer = buildWriterContext({ ...base, history, speaker: { kind: 'narrator' }, outputIndex: 0, brief: '', pendingSpeaker: false });
    expect(writer.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'user']);
    expect(String(writer.messages[0]?.content)).toContain('[P]\nhistory');
    const final = String(writer.messages.at(-1)?.content);
    expect(final.indexOf('[Post-History]')).toBeLessThan(final.indexOf('[Latest User Input]'));
    expect(final.indexOf('[Latest User Input]')).toBeLessThan(final.indexOf('[Current Speaker]'));
  });
});
