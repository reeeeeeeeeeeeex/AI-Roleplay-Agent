import { describe, expect, it } from 'vitest';
import { turnPlanSchema, turnRequestSchema } from './index.js';

describe('turn contracts', () => {
  it('limits a plan to two visible outputs', () => {
    const output = { speaker: { kind: 'narrator' as const }, objective: '', brief: '' };
    expect(() => turnPlanSchema.parse({
      storyTurnId: 'story', sceneObjective: '', outputs: [output, output, output],
      worldEventProposals: [], protagonistStateProposals: [], warnings: [],
    })).toThrow();
  });

  it('requires input for a normal turn', () => {
    expect(() => turnRequestSchema.parse({ conversationId: 'chat', trigger: 'normal' })).toThrow();
  });

  it('accepts authoritative user narration', () => {
    const value = turnRequestSchema.parse({
      conversationId: 'chat',
      input: { voice: 'narrator', text: '雨突然停了。' },
      replyTarget: { mode: 'auto' },
    });
    expect(value.input?.voice).toBe('narrator');
  });
});

