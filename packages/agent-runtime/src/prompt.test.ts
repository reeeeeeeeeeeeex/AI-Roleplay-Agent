import { describe, expect, it } from 'vitest';
import { buildDynamicAnchor, buildStableSystemPrompt, buildWriterContext, fitRequest } from './prompt.js';
import type { MessageNode } from '@new-ai-chat/contracts';

const base = {
  connection: { id: 'c', protocol: 'openai-responses' as const, baseUrl: 'https://example.test/v1', model: 'm', apiKey: '', headers: {}, temperature: 1, maxTokens: 1000, reasoning: 'off' as const },
  storyTurnId: 's', conversationId: 'chat', agencyMode: 'protected' as const,
  narrator: { name: '旁白', style: '冷静' },
  characters: [{ id: 'a', name: 'A', description: 'desc', personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' }],
  persona: { name: 'P', description: 'persona' }, history: [], stableLore: [],
  dynamicContext: [{ source: 'memory' as const, title: 'Stage 1', content: 'past', priority: 1 }],
  latestUserText: '我推开门。', latestUserIsNarration: false,
  source: {} as never, signal: new AbortController().signal,
};

describe('prompt ordering', () => {
  it('places protected protagonist policy in the stable prefix', () => {
    const prompt = buildStableSystemPrompt(base);
    expect(prompt.indexOf('[Protagonist Agency]')).toBeLessThan(prompt.indexOf('[Assistant Role: A]'));
    expect(prompt).toContain('Never invent');
  });

  it('keeps dynamic context before the latest input and speaker control', () => {
    const prompt = buildDynamicAnchor(base, 'brief', { kind: 'narrator' });
    expect(prompt.indexOf('[MEMORY: Stage 1]')).toBeLessThan(prompt.indexOf('[Latest User Input]'));
    expect(prompt.indexOf('[Latest User Input]')).toBeLessThan(prompt.indexOf('[Current Speaker]'));
  });
  it('expands user and scoped character macros without mutating source cards', () => {
    const character = { ...base.characters[0]!, description: '{{char}} greets {{user}}.' };
    expect(buildStableSystemPrompt({ ...base, characters: [character] })).toContain('A greets P.');
    expect(character.description).toBe('{{char}} greets {{user}}.');
  });
  it('keeps group prefix independent of the selected writer', () => {
    const chars = [...base.characters, { ...base.characters[0]!, id: 'b', name: 'B' }];
    const one = buildWriterContext({ ...base, characters: chars, speaker: { kind: 'character', characterId: 'a' }, outputIndex: 0, brief: 'one' });
    const two = buildWriterContext({ ...base, characters: chars, speaker: { kind: 'narrator' }, outputIndex: 1, brief: 'two' });
    expect(one.systemPrompt).toBe(two.systemPrompt);
  });
  it('uses terminal-tool instructions for Planner, not prose-only Writer instructions', () => {
    const prompt = buildStableSystemPrompt(base, 'planner');
    expect(prompt).toContain('submit_turn_plan'); expect(prompt).not.toContain('Return only prose');
  });
  it('keeps user narration in the user role and never replays signed blocks from other speakers', () => {
    const node: MessageNode = { id: 'n', conversationId: 'chat', parentId: null, storyTurnId: 's', role: 'user', authorKind: 'user_narrator', speaker: null, content: 'fact', providerState: { signed: 'private' }, legacyPayload: { secret: 'legacy' }, createdAt: new Date().toISOString() };
    const ctx = buildWriterContext({ ...base, history: [node], speaker: { kind: 'narrator' }, outputIndex: 0, brief: '' });
    expect(ctx.messages[0]?.role).toBe('user'); expect(JSON.stringify(ctx.messages)).toContain('[User Narration]'); expect(JSON.stringify(ctx.messages)).not.toMatch(/private|legacy/);
  });
  it('caps real history but keeps the latest user anchor independently', () => {
    const node = { content: 'old', role: 'assistant' } as MessageNode;
    const request = fitRequest({ ...base, connection: { ...base.connection, historyMessageLimit: 1 }, history: [node, { ...node, content: 'latest' }] });
    expect(request.history.map(m => m.content)).toEqual(['latest']); expect(request.latestUserText).toBe(base.latestUserText);
  });
  it('rejects oversized mandatory context without silently cutting the character card', () => {
    expect(() => fitRequest({ ...base, connection: { ...base.connection, contextWindow: 8192 }, stableLore: [{ source: 'lore', title: 'Huge', priority: 1, content: '文'.repeat(9000) }] })).toThrow(/context budget/);
  });
  it('drops oldest complete messages under token pressure and does not mutate inputs', () => {
    const old = { content: '文'.repeat(5000), role: 'user' } as MessageNode;
    const recent = { content: 'recent', role: 'assistant' } as MessageNode;
    const request = { ...base, connection: { ...base.connection, contextWindow: 8192 }, history: [old, recent] };
    expect(fitRequest(request).history).toEqual([recent]); expect(request.history).toHaveLength(2);
  });
});
