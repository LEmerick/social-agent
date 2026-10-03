/**
 * Modèle d'issues probabiliste (`probabilistic@1`) : logistique ordonnée dont le score est affine dans les axes de
 * l'arête cible → acteur (confiance, affection, rivalité, alliance, peur, respect, attirance) et dans les traits
 * (decision-model.md §4). Les coefficients sont dans `probabilistic-coeffs.ts` ; un coefficient par action, de signe fixe.
 *
 * Propriétés : somme des probabilités = 1 sur les seules issues autorisées de l'action ; P(issue la plus favorable)
 * et P(au moins aussi favorable que k) sont monotones dans chaque axe ; aucune issue hors catalogue n'est possible.
 */
import { NEUTRAL_TRAIT, type TraitKey } from '../../character/compile.js';
import { DomainError } from '../../core/errors.js';
import type { Rng } from '../../core/rng.js';
import { assertInCatalog } from '../../rules/catalog.js';
import { relOf } from '../../rules/preconditions.js';
import type { CharacterNode, Id, SimState } from '../../state/types.js';
import { orderedLogit } from '../heuristic-outcome.js';
import type { ActionOption, OutcomeModel, OutcomeResult } from '../ports.js';
import { type Coeffs, coeffsOf } from './probabilistic-coeffs.js';
import { sampleOutcome } from './softmax.js';
import { successProbability } from './outcome-values.js';

export const PROBABILISTIC_OUTCOME_POLICY = 'probabilistic@1';

const z = (c: Readonly<CharacterNode> | undefined, key: TraitKey): number =>
  ((c?.traits[key] ?? NEUTRAL_TRAIT) - 50) / 50;

/** Score de réussite de l'acteur pour cette option (plus il est grand, plus l'issue favorable est probable). */
export function outcomeScore(state: Readonly<SimState>, actorId: Id, option: ActionOption, coeffs?: Coeffs): number {
  const k = coeffs ?? coeffsOf(option.action);
  const actor = state.characters[actorId];
  const target = option.targetId === null ? undefined : state.characters[option.targetId];
  // Sans cible personnage, l'arête neutre de l'acteur vers lui-même (valeurs par défaut) joue le rôle d'arête.
  const ba = relOf(state, target?.id ?? actorId, actorId);
  let s = k.bias;
  s += (k.trust ?? 0) * ((ba.trust - 50) / 50);
  s += (k.affection ?? 0) * (ba.affection / 100);
  s += (k.rivalry ?? 0) * (ba.rivalry / 100);
  s += (k.alliance ?? 0) * (ba.alliance / 100);
  s += (k.fear ?? 0) * (ba.fear / 100);
  s += (k.respect ?? 0) * ((ba.respect - 50) / 50);
  s += (k.attraction ?? 0) * (ba.attraction / 100);
  if (k.energyGap) s += k.energyGap * (((actor?.stats.energy ?? 50) - (target?.stats.energy ?? 50)) / 100);
  for (const [t, w] of Object.entries(k.actor ?? {})) s += w * z(actor, t as TraitKey);
  for (const [t, w] of Object.entries(k.target ?? {})) s += w * z(target, t as TraitKey);
  return s;
}

export class ProbabilisticOutcomeModel implements OutcomeModel {
  /** Distribution des issues autorisées de l'action, sans tirage (pure). */
  distribution(state: Readonly<SimState>, actorId: Id, option: ActionOption): Record<string, number> {
    const def = assertInCatalog(state, option.action);
    const probs = orderedLogit(outcomeScore(state, actorId, option), def.outcomes.length);
    return Object.fromEntries(def.outcomes.map((o, i) => [o, probs[i] ?? 0]));
  }

  /** P(succès) de l'option (issues de valence ≥ 0,5). */
  successProbability(state: Readonly<SimState>, actorId: Id, option: ActionOption): number {
    return successProbability(option.action, this.distribution(state, actorId, option));
  }

  resolve(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): Promise<OutcomeResult> {
    try {
      const distribution = this.distribution(input.state, input.actorId, input.option);
      const keys = Object.keys(distribution);
      const last = keys[keys.length - 1];
      if (last === undefined) throw new DomainError('UNKNOWN_OUTCOME', `Aucune issue pour ${input.option.action}`);
      if (keys.length === 1) {
        return Promise.resolve({ outcome: last, distribution, rngDraw: null, policy: PROBABILISTIC_OUTCOME_POLICY });
      }
      const draw = input.rng.next();
      return Promise.resolve({
        outcome: sampleOutcome(distribution, draw),
        distribution,
        rngDraw: draw,
        policy: PROBABILISTIC_OUTCOME_POLICY,
      });
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
