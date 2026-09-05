import { describe, expect, it } from 'vitest';
import { fallbackPlan, validatePlan } from './plan.js';

const cast = [{
  id: 'sina', name: 'Sina', description: '', personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '',
}];

describe('speaker plans', () => {
  it('allows narrator plus one character', () => {
    const plan = validatePlan({
      sceneObjective: 'Reveal the room',
      outputs: [
        { speaker: { kind: 'narrator' }, objective: 'Set scene', brief: '' },
        { speaker: { kind: 'character', characterId: 'sina' }, objective: 'Reply', brief: '' },
      ],
    }, 'turn-1', cast);
    expect(plan.outputs).toHaveLength(2);
  });

  it('rejects unknown and duplicate speakers', () => {
    expect(() => validatePlan({ sceneObjective: '', outputs: [
      { speaker: { kind: 'narrator' }, objective: '', brief: '' },
      { speaker: { kind: 'narrator' }, objective: '', brief: '' },
    ] }, 'turn-1', cast)).toThrow(/Duplicate/);
    expect(() => validatePlan({ sceneObjective: '', outputs: [
      { speaker: { kind: 'character', characterId: 'missing' }, objective: '', brief: '' },
    ] }, 'turn-1', cast)).toThrow(/Unknown/);
  });

  it('falls back to the current character', () => {
    expect(fallbackPlan('turn-1', cast).outputs[0]?.speaker).toEqual({ kind: 'character', characterId: 'sina' });
  });
});

