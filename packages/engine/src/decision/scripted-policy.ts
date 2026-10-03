/**
 * Politique de décision scriptée pour les tests et les jalons M2 à M4 (implementation-plan.md §1) :
 * les destinations et les actions sont écrites à l'avance, par personnage et par tick.
 */
import type { Id } from '../state/types.js';
import {
  type ActionOption,
  type DecisionPolicy,
  type DecisionResult,
  type DestinationChoice,
  optionKey,
} from './ports.js';

export interface ScriptedPolicyScript {
  /** `{ [characterId]: { [tick]: choix } }` ; `stay` quand rien n'est écrit. */
  readonly destinations?: Readonly<Record<Id, Readonly<Record<number, DestinationChoice>>>>;
  /** `{ [characterId]: { [tick]: action } }` ; `null` (ne rien faire) quand rien n'est écrit. */
  readonly actions?: Readonly<Record<Id, Readonly<Record<number, ActionOption>>>>;
}

export class ScriptedDecisionPolicy implements DecisionPolicy {
  readonly #script: ScriptedPolicyScript;

  constructor(script: ScriptedPolicyScript = {}) {
    this.#script = script;
  }

  /**
   * L'action écrite pour ce tick (`state.tick`) n'est rendue que si elle figure parmi les `options`
   * (comparées par `optionKey`) : une action dont les préconditions ne sont pas remplies n'est pas jouée.
   */
  choose(input: Parameters<DecisionPolicy['choose']>[0]): Promise<DecisionResult> {
    const scripted = this.#script.actions?.[input.actorId]?.[input.state.tick];
    const wanted = scripted ? optionKey(scripted) : null;
    const chosen = wanted === null ? null : (input.options.find((o) => optionKey(o) === wanted) ?? null);
    return Promise.resolve({ chosen, rngDraw: null, policy: 'scripted@1' });
  }

  chooseDestination(input: Parameters<DecisionPolicy['chooseDestination']>[0]): Promise<DestinationChoice> {
    return Promise.resolve(this.#script.destinations?.[input.actorId]?.[input.state.tick] ?? { kind: 'stay' });
  }
}
