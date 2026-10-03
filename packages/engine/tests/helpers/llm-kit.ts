/** Outils des tests des agents LLM : situation Palmiers, persona, entrées de dialogue. */
import { FakeLLM, IDS, aSimState, aWorld } from '@ai-reality/testkit';
import { Rng } from '../../src/core/rng.js';
import { personaPrompt } from '../../src/character/compile.js';
import type { ActionOption } from '../../src/decision/ports.js';
import type { DialogueInput } from '../../src/interaction/dialogue.js';
import type { SimState } from '../../src/state/types.js';

export const C = IDS.characters;
export const L = IDS.locations;

const records = aWorld().build().characters;

/** Persona compilé du vrai personnage de la fixture. */
export const personaOf = (characterId: string): string => {
  const record = records.find((c) => c.id === characterId);
  if (!record) throw new Error(`personnage ${characterId} absent de la fixture`);
  return personaPrompt(record);
};

export const option = (
  action: string,
  targetId: string | null = null,
  over: Partial<ActionOption> = {},
): ActionOption => ({
  action,
  targetId,
  factId: null,
  itemId: null,
  locationId: null,
  ...over,
});

/** Les quatre candidats au jardin ; Sarah seule connaît son secret. */
export function palmiersAtGarden(mutate?: (state: SimState) => void): SimState {
  return aSimState((state) => {
    for (const id of Object.keys(state.characters)) {
      state.positions[id] = { kind: 'at', locationId: L.jardin, zoneId: null };
    }
    mutate?.(state);
  });
}

export const fakeLlm = (): FakeLLM => new FakeLLM();

export function dialogueInput(state: SimState, opt: ActionOption, outcome: string): DialogueInput {
  return {
    state,
    interactionId: 'interaction-1',
    sceneId: 'scene-1',
    option: opt,
    actorId: C.alexandre,
    outcome,
    volume: 'whisper',
    listeners: [],
    rng: Rng.derive('llm-test', 'dialogue'),
  };
}

export const speakReply = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  text: 'Sarah, on devrait faire équipe.',
  intent: 'propose_alliance',
  tone: 'posé',
  emotion: 'confiance',
  reveals: [],
  mentions: [],
  wantsToContinue: true,
  ...over,
});
