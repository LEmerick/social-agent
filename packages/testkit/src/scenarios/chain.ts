/**
 * Scénario « chaîne » de la Maison des Palmiers : Alexandre propose une alliance à Sarah (jardin), Sarah le raconte à
 * Léa (intention différée), Léa à Thomas, Thomas confronte Alexandre. Les events forment la chaîne
 * E1 ← E2 ← E3 ← E4 par `caused_by_event_id`. Partagé par les tests du moteur et de la narration.
 */
import {
  type DecisionPolicy,
  type DecisionResult,
  type DestinationChoice,
  type EpochHooks,
  type Id,
  type StoragePort,
  AgendaDecisionPolicy,
  ScriptedDecisionPolicy,
  ScriptedOutcomeModel,
  createEpochScheduler,
  economyHook,
  interactionHook,
} from '@ai-reality/engine';
import { type WorldFixture, aWorld, seedWorld } from '../builders.js';
import { IDS } from '../fixtures/ids.js';

const C = IDS.characters;
const L = IDS.locations;
const Z = IDS.zones;

export const CHAIN_PROPOSAL = 'a proposé une alliance à';

const go = (locationId: Id, zoneId: Id | null = null): DestinationChoice => ({ kind: 'go', locationId, zoneId });

interface Turn {
  readonly action: string;
  readonly targetId: Id;
  /** Le fait de l'alliance proposée (créé pendant l'exécution : son identifiant n'est connu qu'alors). */
  readonly aboutProposal: boolean;
}

const say = (action: string, targetId: Id, aboutProposal = false): Turn => ({ action, targetId, aboutProposal });

/** Destinations écrites ; actions écrites par tick, avec le fait de l'alliance retrouvé dans l'état. */
export class ChainScript implements DecisionPolicy {
  readonly #moves = new ScriptedDecisionPolicy({
    destinations: {
      [C.alexandre]: { 0: go(L.jardin, Z.banc) },
      [C.sarah]: { 0: go(L.jardin, Z.banc), 1: go(L.cuisine) },
      [C.lea]: { 0: go(L.cuisine), 4: go(L.salon) },
      [C.thomas]: { 0: go(L.chambres), 4: go(L.salon), 6: go(L.jardin, Z.banc) },
    },
  });
  readonly #turns: Readonly<Record<Id, Readonly<Record<number, Turn>>>> = {
    [C.alexandre]: { 0: say('propose_alliance', C.sarah) },
    // Tick 3 : Sarah n'a pas de tour écrit, c'est son intention différée qui la fait parler.
    [C.lea]: { 5: say('share_secret', C.thomas, true) },
    [C.thomas]: { 7: say('confront', C.alexandre, true) },
  };

  choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    const turn = this.#turns[input.actorId]?.[input.state.tick];
    const proposal = Object.values(input.state.facts).find((f) => f.predicate === CHAIN_PROPOSAL)?.id ?? null;
    const chosen =
      turn === undefined
        ? null
        : (input.options.find(
            (o) =>
              o.action === turn.action &&
              o.targetId === turn.targetId &&
              o.factId === (turn.aboutProposal ? proposal : null),
          ) ?? null);
    return Promise.resolve({ chosen, rngDraw: null, policy: 'scripted@1' });
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]) {
    return this.#moves.chooseDestination(input);
  }
}

/** Politique (avec intentions différées) et issues du scénario. */
export const chainPolicies = () => ({
  decision: new AgendaDecisionPolicy(new ChainScript()),
  outcome: new ScriptedOutcomeModel({
    propose_alliance: 'accepted',
    share_secret: 'believed',
    confront: 'escalated',
  }),
});

/** Sème les Palmiers et joue l'époque 0 de la chaîne. `extraTick` : hooks de tick additionnels (observation). */
export async function playChainEpoch(
  storage: StoragePort,
  extraTick: NonNullable<EpochHooks['tick']> = [],
): Promise<{ fixture: WorldFixture; epochId: Id }> {
  const fixture = await seedWorld(storage, aWorld().build());
  const { decision, outcome } = chainPolicies();
  await createEpochScheduler({
    storage,
    decision,
    outcome,
    hooks: { tick: [interactionHook(), ...extraTick], economy: economyHook() },
  }).run({ worldId: fixture.world.id, seasonNumber: fixture.season.number, number: 0 }).done;
  const epoch = await storage.tx((s) => s.epochs.findByNumber(fixture.world.id, 0));
  if (!epoch) throw new Error('époque 0 absente après la chaîne');
  return { fixture, epochId: epoch.id };
}
