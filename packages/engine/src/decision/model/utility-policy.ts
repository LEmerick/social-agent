/**
 * `UtilityDecisionPolicy` (`utility@1`) : utilité par option, puis softmax à température liée à l'impulsivité
 * (decision-model.md §2-3). Le tirage vient du `Rng` fourni ; `distribution` et `rngDraw` sont renseignés.
 * Une option interdite par la directive (`forbid`) n'est jamais choisie, sauf si toutes le sont.
 */
import type { Id, SimState } from '../../state/types.js';
import type { Rng } from '../../core/rng.js';
import type { ActionOption, DecisionPolicy, DecisionResult, DestinationChoice } from '../ports.js';
import { sampleIndex, softmax, temperatureOf, type TemperatureConfig } from './softmax.js';
import { chooseDestinationByScore } from './utility-destination.js';
import { type UtilityConfig, utilitiesOf } from './utility.js';
import { weightsOf } from './weights.js';

export const UTILITY_POLICY = 'utility@1';

export interface UtilityPolicyConfig extends UtilityConfig {
  readonly temperature?: TemperatureConfig;
}

/** Distribution softmax sur les options (réutilisée par le Monte Carlo pour les réactions et les candidats). */
export function utilityDistribution(
  state: Readonly<SimState>,
  actorId: Id,
  options: readonly ActionOption[],
  config: UtilityPolicyConfig = {},
): { readonly option: ActionOption; readonly p: number; readonly utility: number }[] {
  const actor = state.characters[actorId];
  const temperature = temperatureOf(actor ? weightsOf(actor).reactivity : 0.5, config.temperature);
  const { utilities, groupSizes } = utilitiesOf(state, actorId, options, config);
  // Un groupe d'options qui ne diffèrent que par le fait pèse comme une seule option : −T × ln(taille du groupe).
  const probs = softmax(
    utilities.map((u, i) => u - temperature * Math.log(groupSizes[i] ?? 1)),
    temperature,
  );
  return options.map((option, i) => ({ option, p: probs[i] ?? 0, utility: utilities[i] ?? -Infinity }));
}

export class UtilityDecisionPolicy implements DecisionPolicy {
  readonly #config: UtilityPolicyConfig;

  constructor(config: UtilityPolicyConfig = {}) {
    this.#config = config;
  }

  choose(input: {
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly options: readonly ActionOption[];
    readonly rng: Rng;
  }): Promise<DecisionResult> {
    const { actorId, state, options, rng } = input;
    if (options.length === 0) return Promise.resolve({ chosen: null, rngDraw: null, policy: UTILITY_POLICY });
    const distribution = utilityDistribution(state, actorId, options, this.#config).map(({ option, p }) => ({
      option,
      p,
    }));
    const draw = rng.next();
    const chosen =
      options[
        sampleIndex(
          distribution.map((d) => d.p),
          draw,
        )
      ] ?? null;
    return Promise.resolve({ chosen, distribution, rngDraw: draw, policy: UTILITY_POLICY });
  }

  chooseDestination(input: {
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): Promise<DestinationChoice> {
    return Promise.resolve(chooseDestinationByScore(input.state, input.actorId));
  }
}
