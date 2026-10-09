import { AppError } from '@new-ai-chat/contracts';
import { turnPlanSchema, type ReplyTarget, type SpeakerRef, type TurnPlan } from '@new-ai-chat/contracts';
import type { RuntimeCharacter } from './types.js';

export function validatePlan(plan: unknown, storyTurnId: string, characters: RuntimeCharacter[]): TurnPlan {
  const parsed = turnPlanSchema.parse({ ...(plan as object), storyTurnId });
  const characterIds = new Set(characters.map((character) => character.id));
  const seen = new Set<string>();
  for (const output of parsed.outputs) {
    const key = output.speaker.kind === 'narrator' ? 'narrator' : `character:${output.speaker.characterId}`;
    if (seen.has(key)) throw new AppError("Duplicate output speaker: {0}", key);
    seen.add(key);
    if (output.speaker.kind === 'character' && !characterIds.has(output.speaker.characterId)) {
      throw new AppError("Unknown character: {0}", output.speaker.characterId);
    }
  }
  return parsed;
}

export function fallbackPlan(storyTurnId: string, characters: RuntimeCharacter[], target?: ReplyTarget): TurnPlan {
  let speaker: SpeakerRef = { kind: 'narrator' };
  if (target?.mode === 'explicit') speaker = target.speaker;
  else if (characters[0]) speaker = { kind: 'character', characterId: characters[0].id };
  return {
    storyTurnId,
    sceneObjective: 'Continue the current scene naturally.',
    outputs: [{ speaker, objective: 'Respond to the latest user turn.', brief: 'Continue naturally and preserve established facts.' }],
    worldEventProposals: [],
    protagonistStateProposals: [],
    warnings: ['Agent routing fell back to the current speaker.'],
  };
}

