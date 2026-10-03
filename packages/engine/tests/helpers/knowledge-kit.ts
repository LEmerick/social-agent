/** Outils des tests de propagation : mini-scénarios scriptés sur Palmiers, relus depuis le stockage. */
import {
  type ActionOption,
  type DialogueGenerator,
  type EpochHooks,
  type Id,
  type OutcomeModel,
  ScriptedDecisionPolicy,
  type SimState,
  SummaryDialogue,
  type UtteranceDraft,
  loadSimState,
} from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { IDS, aWorld, seedWorld } from '@ai-reality/testkit';
import { ScriptedOutcomeModel } from '../../src/decision/scripted-outcome.js';
import { interactionHook } from '../../src/interaction/index.js';
import { C, snapshotOf, type DestinationScript } from './epoch-kit.js';
import { interactionScheduler, runOf } from './interaction-kit.js';

export const option = (action: string, targetId: Id | null, factId: Id | null = null): ActionOption => ({
  action,
  targetId,
  factId,
  itemId: null,
  locationId: null,
});

export interface MiniScript {
  readonly destinations: DestinationScript;
  readonly actions: Readonly<Record<Id, Readonly<Record<number, ActionOption>>>>;
  readonly outcomes?: Readonly<Record<string, string>>;
  readonly dialogue?: DialogueGenerator;
  readonly outcomeModel?: OutcomeModel;
}

/** Une époque scriptée sur Palmiers ; rend l'état relu du stockage, le journal et les arêtes de relation. */
export async function runMini(script: MiniScript, hooks?: Partial<EpochHooks>) {
  const storage = createMemoryStorage();
  const fixture = await seedWorld(storage, aWorld().build());
  const decision = new ScriptedDecisionPolicy({ destinations: script.destinations, actions: script.actions });
  const outcome = script.outcomeModel ?? new ScriptedOutcomeModel(script.outcomes ?? {});
  const all: EpochHooks = {
    tick: [interactionHook(script.dialogue ? { dialogue: script.dialogue } : {}), ...(hooks?.tick ?? [])],
  };
  await interactionScheduler(storage, decision, outcome, all).run(runOf(fixture)).done;
  const snap = await snapshotOf(storage, fixture.world.id, 0);
  const state: SimState = await loadSimState(storage, fixture.world.id, fixture.season.number);
  return { storage, fixture, state, ...snap };
}

/** Dialogue résumé auquel on ajoute des faits « révélés » par le locuteur, comme le ferait un agent LLM. */
export class RevealingDialogue implements DialogueGenerator {
  readonly #inner = new SummaryDialogue();
  readonly #extra: readonly Id[];

  constructor(extra: readonly Id[]) {
    this.#extra = extra;
  }

  async generate(input: Parameters<DialogueGenerator['generate']>[0]) {
    const base = await this.#inner.generate(input);
    const utterances: UtteranceDraft[] = base.utterances.map((u) => ({
      ...u,
      revealedFactIds: [...u.revealedFactIds, ...this.#extra],
    }));
    return { ...base, utterances };
  }
}

export const knowledgeOf = (state: SimState, characterId: Id, factId: Id) =>
  Object.values(state.knowledge).filter((k) => k.characterId === characterId && k.factId === factId);

export { C, IDS };
