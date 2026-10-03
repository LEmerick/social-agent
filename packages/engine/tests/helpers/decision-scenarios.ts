/** Scénarios « alliance » et « chain » rejoués avec `UtilityDecisionPolicy` + `ProbabilisticOutcomeModel` (M9, non-régression). */
import {
  AgendaDecisionPolicy,
  type DecisionPolicy,
  type DestinationChoice,
  type Id,
  type StoragePort,
  loadSimState,
  provenance,
} from '@ai-reality/engine';
import { IDS, aWorld, seedWorld } from '@ai-reality/testkit';
import { ProbabilisticOutcomeModel, UtilityDecisionPolicy } from '../../src/decision/model/index.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { C, L, Z, go, snapshotOf } from './epoch-kit.js';
import { fullHooks, interactionScheduler, runOf } from './interaction-kit.js';

/** Destinations écrites (comme dans les scénarios scriptés), choix d'actions par la politique d'utilité. */
class ScriptedMoves implements DecisionPolicy {
  readonly #moves: ScriptedDecisionPolicy;
  readonly #choice: DecisionPolicy;

  constructor(destinations: Record<Id, Record<number, DestinationChoice>>, choice: DecisionPolicy) {
    this.#moves = new ScriptedDecisionPolicy({ destinations });
    this.#choice = choice;
  }

  choose(input: Parameters<DecisionPolicy['choose']>[0]) {
    return this.#choice.choose(input);
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]) {
    return this.#moves.chooseDestination(input);
  }
}

/** La consigne du joueur à Alexandre : proposer une alliance à Sarah (biais d'action et de cible). */
export const ALEXANDRE_WANTS_ALLIANCE = {
  id: '01960000-0000-7000-8000-00000000d001',
  characterId: C.alexandre,
  text: 'Propose une alliance à Sarah',
  fromEpoch: 0,
  toEpoch: null,
  biases: { actions: { propose_alliance: 4 }, targets: { [C.sarah]: 2 }, prefer: ['propose_alliance'], forbid: [] },
} as const;

export async function runAllianceUtility(storage: StoragePort, seed: string) {
  const fixture = await seedWorld(storage, aWorld().withSeed(seed).withDirective(ALEXANDRE_WANTS_ALLIANCE).build());
  const decision = new ScriptedMoves(
    { [C.alexandre]: { 0: go(L.jardin, Z.banc) }, [C.sarah]: { 0: go(L.jardin, Z.banc) } },
    new UtilityDecisionPolicy({ temperature: { fixed: 0.2 } }),
  );
  await interactionScheduler(storage, decision, new ProbabilisticOutcomeModel()).run(runOf(fixture)).done;
  return { fixture, ...(await snapshotOf(storage, fixture.world.id, 0)) };
}

export async function runChainUtility(storage: StoragePort, seed: string) {
  const fixture = await seedWorld(storage, aWorld().withSeed(seed).withDirective(ALEXANDRE_WANTS_ALLIANCE).build());
  const base = new ScriptedMoves(
    {
      [C.alexandre]: { 0: go(L.jardin, Z.banc) },
      [C.sarah]: { 0: go(L.jardin, Z.banc), 1: go(L.cuisine) },
      [C.lea]: { 0: go(L.cuisine), 4: go(L.salon) },
      [C.thomas]: { 0: go(L.chambres), 4: go(L.salon), 6: go(L.jardin, Z.banc) },
    },
    new UtilityDecisionPolicy({ temperature: { fixed: 0.2 } }),
  );
  const decision = new AgendaDecisionPolicy(base);
  await interactionScheduler(storage, decision, new ProbabilisticOutcomeModel(), fullHooks()).run(runOf(fixture)).done;
  const snap = await snapshotOf(storage, fixture.world.id, 0);
  const state = await loadSimState(storage, fixture.world.id, fixture.season.number);
  const proposal = Object.values(state.facts).find((f) => f.predicate === 'a proposé une alliance à');
  const chainOf = (who: Id) => (proposal ? provenance(state, who, proposal.id) : []);
  return { fixture, state, proposal, chainOf, ...snap, IDS };
}
