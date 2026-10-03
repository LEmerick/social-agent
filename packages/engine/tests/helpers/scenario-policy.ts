/**
 * Politique de scénario : destinations écrites par tick, actions choisies par motif (les identifiants d'objets et de
 * faits ne sont connus qu'à l'exécution), et réponses fixes aux questions du conseil (jeu des objets, bulletins).
 */
import {
  type ActionOption,
  type DecisionPolicy,
  type DecisionResult,
  type DestinationChoice,
  type Id,
  type SimState,
} from '@ai-reality/engine';

export interface Step {
  readonly actor: Id;
  readonly tick: number;
  readonly action: string;
  readonly targetId?: Id;
  readonly locationId?: Id;
  /** Filtre supplémentaire sur l'option (fait, objet…). */
  readonly where?: (option: ActionOption, state: Readonly<SimState>) => boolean;
}

export interface ScenarioScript {
  readonly destinations?: Readonly<Record<Id, Readonly<Record<number, DestinationChoice>>>>;
  readonly steps?: readonly Step[];
  /** Porteurs qui jouent leur objet au conseil. */
  readonly councilItems?: readonly Id[];
  /** Électeur → cible du bulletin. */
  readonly votes?: Readonly<Record<Id, Id>>;
  /** Règle de bulletin par défaut (candidats déjà privés de soi) : par exemple « le plus petit identifiant ». */
  readonly voteRule?: (voterId: Id, candidates: readonly Id[]) => Id | undefined;
}

export class ScenarioPolicy implements DecisionPolicy {
  readonly #script: ScenarioScript;

  constructor(script: ScenarioScript = {}) {
    this.#script = script;
  }

  choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    const { options, actorId, state } = input;
    const result = (chosen: ActionOption | null): Promise<DecisionResult> =>
      Promise.resolve({ chosen, rngDraw: null, policy: 'scenario@1' });
    if (options.length > 0 && options.every((o) => o.action === 'use_item')) {
      return result(this.#script.councilItems?.includes(actorId) ? (options[0] ?? null) : null);
    }
    if (options.length > 0 && options.every((o) => o.action === 'cast_vote')) {
      const target =
        this.#script.votes?.[actorId] ??
        this.#script.voteRule?.(
          actorId,
          options.flatMap((o) => (o.targetId ? [o.targetId] : [])),
        );
      return result(options.find((o) => o.targetId === target) ?? null);
    }
    const step = this.#script.steps?.find((s) => s.actor === actorId && s.tick === state.tick);
    if (!step) return result(null);
    return result(
      options.find(
        (o) =>
          o.action === step.action &&
          (step.targetId === undefined || o.targetId === step.targetId) &&
          (step.locationId === undefined || o.locationId === step.locationId) &&
          (step.where === undefined || step.where(o, state)),
      ) ?? null,
    );
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]): Promise<DestinationChoice> {
    return Promise.resolve(this.#script.destinations?.[input.actorId]?.[input.state.tick] ?? { kind: 'stay' });
  }
}
