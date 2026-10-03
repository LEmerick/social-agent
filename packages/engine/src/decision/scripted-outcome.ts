/** Issues imposées par le test (`OutcomeModel` scripté, `scripted@1`). */
import { DomainError } from '../core/errors.js';
import { assertInCatalog } from '../rules/catalog.js';
import type { OutcomeModel, OutcomeResult, ActionOption } from './ports.js';
import { optionKey } from './ports.js';
import type { Id, SimState } from '../state/types.js';

export const SCRIPTED_OUTCOME_POLICY = 'scripted@1';

export interface ScriptedInput {
  readonly option: ActionOption;
  readonly actorId: Id;
}

/**
 * - tableau : issues consommées dans l'ordre des appels ;
 * - objet : issue par `optionKey(option)`, à défaut par nom d'action ;
 * - fonction : issue calculée à partir de l'option.
 */
export type OutcomeScript =
  readonly string[] | Readonly<Record<string, string>> | ((input: ScriptedInput) => string | undefined);

export class ScriptedOutcomeModel implements OutcomeModel {
  readonly #script: OutcomeScript;
  #cursor = 0;

  /** Sans issue scriptée pour un appel, la première issue autorisée de l'action (la plus favorable) est retenue. */
  constructor(script: OutcomeScript = []) {
    this.#script = script;
  }

  resolve(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
  }): Promise<OutcomeResult> {
    try {
      return Promise.resolve(this.#pick(input));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  #pick(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
  }): OutcomeResult {
    const def = assertInCatalog(input.state, input.option.action);
    const scripted = this.#next(input);
    const outcome = scripted ?? def.outcomes[0];
    if (outcome === undefined || !(def.outcomes as readonly string[]).includes(outcome)) {
      throw new DomainError('UNKNOWN_OUTCOME', `Issue scriptée ${String(outcome)} non autorisée pour ${def.id}`);
    }
    return { outcome, rngDraw: null, policy: SCRIPTED_OUTCOME_POLICY };
  }

  #next(input: ScriptedInput): string | undefined {
    const script = this.#script;
    if (typeof script === 'function') return script(input);
    if (Array.isArray(script)) return (script as readonly string[])[this.#cursor++];
    const byKey = script as Readonly<Record<string, string>>;
    return byKey[optionKey(input.option)] ?? byKey[input.option.action];
  }
}
