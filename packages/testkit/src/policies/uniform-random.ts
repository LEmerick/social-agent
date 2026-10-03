import {
  type ActionOption,
  type DecisionPolicy,
  type DecisionResult,
  type DestinationChoice,
  type Id,
  type Rng,
} from '@ai-reality/engine';

export interface UniformRandomOptions {
  /** Probabilité de ne rien faire à un tick (0 par défaut : toujours une action). */
  readonly idleProbability?: number;
  /** Probabilité de changer de lieu à un tick (0.1 par défaut). */
  readonly moveProbability?: number;
}

/**
 * Politique de test : choix uniforme parmi les options et les lieux, tiré avec le `Rng` fourni par le moteur.
 * Déterministe : mêmes graine, mêmes tirages, mêmes choix. `rngDraw` porte la valeur tirée.
 */
export class UniformRandomPolicy implements DecisionPolicy {
  readonly #idle: number;
  readonly #move: number;

  constructor(options: UniformRandomOptions = {}) {
    this.#idle = options.idleProbability ?? 0;
    this.#move = options.moveProbability ?? 0.1;
  }

  choose(input: { readonly options: readonly ActionOption[]; readonly rng: Rng }): Promise<DecisionResult> {
    const { options, rng } = input;
    const draw = rng.next();
    const policy = 'uniform-random@1';
    if (options.length === 0 || draw < this.#idle) return Promise.resolve({ chosen: null, rngDraw: draw, policy });
    const scaled = (draw - this.#idle) / (1 - this.#idle);
    const index = Math.min(options.length - 1, Math.floor(scaled * options.length));
    return Promise.resolve({ chosen: options[index] ?? null, rngDraw: draw, policy });
  }

  chooseDestination(input: {
    readonly actorId: Id;
    readonly state: { readonly locations: Readonly<Record<Id, unknown>> };
    readonly rng: Rng;
  }): Promise<DestinationChoice> {
    const draw = input.rng.next();
    if (draw >= this.#move) return Promise.resolve({ kind: 'stay' });
    const locations = Object.keys(input.state.locations).sort();
    const locationId = locations[input.rng.int(locations.length)];
    return Promise.resolve(locationId === undefined ? { kind: 'stay' } : { kind: 'go', locationId, zoneId: null });
  }
}
