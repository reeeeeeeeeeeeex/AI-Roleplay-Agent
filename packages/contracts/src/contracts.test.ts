import { describe, expect, it } from 'vitest';
import { turnPlanSchema, turnRequestSchema, generalSettingsSchema, actionChoiceSettingsSchema, promptSettingsSchema } from './index.js';
import { defaultGeneralSettings, defaultActionChoiceSettings, defaultPromptSettings } from './client.js';

it('browser defaults match the server defaults for settings and prompts', () => {
  expect({ general: defaultGeneralSettings, choices: defaultActionChoiceSettings, prompts: defaultPromptSettings })
    .toEqual({ general: generalSettingsSchema.parse({}), choices: actionChoiceSettingsSchema.parse({}), prompts: promptSettingsSchema.parse({}) });
});

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

  it('accepts group input with avatarPath', async () => {
    const { groupInputSchema } = await import('./index.js');
    const group = groupInputSchema.parse({
      name: '探索小队',
      memberIds: ['char-1', 'char-2'],
      scenario: '森林探险',
      avatarPath: '/api/assets/cover.png',
    });
    expect(group.avatarPath).toBe('/api/assets/cover.png');
    const defaultGroup = groupInputSchema.parse({
      name: '小队2',
      memberIds: ['char-1'],
    });
    expect(defaultGroup.avatarPath).toBeNull();
  });
});

