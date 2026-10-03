/**
 * Politique des personnages non joués, sans LLM : tirage pondéré par le `Rng` du moteur (donc déterministe).
 * Les gestes aimables sont plus fréquents que les coups bas ; les NPC se retrouvent surtout dans les pièces communes.
 */
import type {
  ActionOption,
  DecisionPolicy,
  DecisionResult,
  DestinationChoice,
  Id,
  Rng,
  SimState,
} from '@ai-reality/engine';

export const NPC_POLICY = 'npc-weighted@1';

const ACTION_WEIGHTS: Readonly<Record<string, number>> = {
  small_talk: 6,
  compliment: 4,
  comfort: 2,
  confide: 2,
  probe: 2,
  flirt: 1.5,
  apologize: 1,
  propose_alliance: 1.5,
  request_favor: 1,
  share_secret: 1,
  spread_rumor: 0.8,
  lie: 0.6,
  deflect: 0.3,
  provoke: 0.5,
  insult: 0.3,
  confront: 0.5,
  accuse: 0.4,
  threaten: 0.3,
  break_alliance: 0.2,
  sabotage: 0.1,
  eavesdrop: 0.4,
  rest: 2,
};

const PLACE_WEIGHTS: Readonly<Record<string, number>> = {
  salon: 4,
  cuisine: 3,
  jardin: 3,
  chambres: 1.5,
  confessionnal: 0.5,
};

export interface NpcPolicyOptions {
  /** Probabilité de ne rien faire à un tick (défaut 0,35). */
  readonly idleProbability?: number;
  /** Probabilité de changer de lieu à un tick (défaut 0,2). */
  readonly moveProbability?: number;
}

function weightedIndex(weights: readonly number[], draw: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const [i, w] of weights.entries()) {
    acc += w / total;
    if (draw < acc) return i;
  }
  return weights.length - 1;
}

export class NpcDecisionPolicy implements DecisionPolicy {
  readonly #idle: number;
  readonly #move: number;

  constructor(options: NpcPolicyOptions = {}) {
    this.#idle = options.idleProbability ?? 0.35;
    this.#move = options.moveProbability ?? 0.2;
  }

  choose(input: { readonly options: readonly ActionOption[]; readonly rng: Rng }): Promise<DecisionResult> {
    const { options, rng } = input;
    const draw = rng.next();
    if (options.length === 0 || draw < this.#idle) {
      return Promise.resolve({ chosen: null, rngDraw: draw, policy: NPC_POLICY });
    }
    const pick = rng.next();
    const index = weightedIndex(
      options.map((o) => ACTION_WEIGHTS[o.action] ?? 0.5),
      pick,
    );
    return Promise.resolve({ chosen: options[index] ?? null, rngDraw: pick, policy: NPC_POLICY });
  }

  chooseDestination(input: {
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): Promise<DestinationChoice> {
    const { state, rng, actorId } = input;
    const stay: DestinationChoice = { kind: 'stay' };
    const position = state.positions[actorId];
    const offstage = position?.kind === 'offstage';
    // Hors-champ (début d’époque) : on apparaît toujours quelque part.
    if (!offstage && rng.next() >= this.#move) return Promise.resolve(stay);

    const here = position?.kind === 'at' ? position.locationId : null;
    const candidates = Object.values(state.locations)
      .filter((l) => l.id !== here)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (candidates.length === 0) return Promise.resolve(stay);
    const target =
      candidates[
        weightedIndex(
          candidates.map((l) => PLACE_WEIGHTS[l.slug] ?? 1),
          rng.next(),
        )
      ];
    return Promise.resolve(target ? { kind: 'go', locationId: target.id, zoneId: null } : stay);
  }
}
