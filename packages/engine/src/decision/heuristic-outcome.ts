/**
 * Modèle d'issues heuristique (`heuristic@1`) : logistique ordonnée sur la relation de la cible vers l'acteur
 * et sur les traits, tirage via le `Rng` fourni (action-catalog.md §5, plan M3).
 *
 * Les issues d'une action sont ordonnées de la plus favorable à la moins favorable (`ActionDef.outcomes`).
 * Un score `s` (plus il est grand, plus l'acteur réussit) répartit les probabilités par seuils logistiques :
 * P(pire que k) = σ(t_k − s). Monotone : augmenter `s` ne fait jamais baisser P(issue la plus favorable),
 * ni P(au moins aussi favorable que k).
 */
import { NEUTRAL_TRAIT } from '../character/compile.js';
import { DomainError } from '../core/errors.js';
import type { Rng } from '../core/rng.js';
import { assertInCatalog } from '../rules/catalog.js';
import { relOf } from '../rules/preconditions.js';
import type { ActionId } from '../rules/types.js';
import type { CharacterNode, Id, SimState } from '../state/types.js';
import type { ActionOption, OutcomeModel, OutcomeResult } from './ports.js';

export const HEURISTIC_OUTCOME_POLICY = 'heuristic@1';

type Stance = 'cooperative' | 'hostile' | 'pressure' | 'belief' | 'covert' | 'contest' | 'chance';

const STANCE: Readonly<Partial<Record<ActionId, Stance>>> = {
  small_talk: 'cooperative',
  compliment: 'cooperative',
  confide: 'cooperative',
  comfort: 'cooperative',
  probe: 'cooperative',
  flirt: 'cooperative',
  express_feelings: 'cooperative',
  apologize: 'cooperative',
  propose_alliance: 'cooperative',
  break_alliance: 'cooperative',
  request_favor: 'cooperative',
  negotiate_vote: 'cooperative',
  deflect: 'cooperative',
  give: 'cooperative',
  trade: 'cooperative',
  join_activity: 'cooperative',
  provoke: 'hostile',
  insult: 'hostile',
  confront: 'pressure',
  accuse: 'pressure',
  threaten: 'pressure',
  share_secret: 'belief',
  spread_rumor: 'belief',
  lie: 'belief',
  sabotage: 'covert',
  eavesdrop: 'covert',
  steal: 'covert',
  hide: 'covert',
  fake_item: 'covert',
  spy_camp: 'covert',
  challenge: 'contest',
  search: 'chance',
  use_item: 'chance',
};

const t = (c: Readonly<CharacterNode> | undefined, key: string): number => (c?.traits[key] ?? NEUTRAL_TRAIT) - 50;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Écart entre deux seuils consécutifs du modèle ordonné. */
const SPACING = 1.2;

/** Répartition ordonnée : `n` issues, de la plus favorable à la moins favorable, pour un score `s`. */
export function orderedLogit(s: number, n: number): number[] {
  if (n <= 1) return [1];
  // Probabilité d'être strictement pire que l'issue k (k = 0..n-2), décroissante avec k.
  const worse = Array.from({ length: n - 1 }, (_, k) => sigmoid(((n - 2) / 2 - k) * SPACING - s));
  return Array.from({ length: n }, (_, k) => (k === 0 ? 1 : (worse[k - 1] ?? 0)) - (worse[k] ?? 0));
}

/** Score de réussite de l'acteur : fonction de la relation cible→acteur et des traits. */
export function successScore(state: Readonly<SimState>, actorId: Id, option: ActionOption, stance: Stance): number {
  const actor = state.characters[actorId];
  const target = option.targetId === null ? undefined : state.characters[option.targetId];
  const ba = relOf(state, target?.id ?? actorId, actorId);
  switch (stance) {
    case 'cooperative':
      return (
        1 +
        0.05 * (ba.trust - 50) +
        0.02 * ba.affection +
        0.02 * ba.alliance -
        0.03 * ba.rivalry +
        0.015 * t(actor, 'charisma') +
        0.01 * t(target, 'empathy')
      );
    case 'hostile':
      return 0.04 * ba.rivalry - 0.02 * (ba.trust - 50) + 0.015 * t(target, 'impulsivity');
    case 'pressure':
      return 0.2 + 0.03 * ba.fear + 0.03 * (ba.trust - 50) + 0.015 * t(actor, 'charisma') - 0.02 * ba.rivalry;
    case 'belief':
      return (
        0.8 +
        0.05 * (ba.trust - 50) +
        (option.action === 'lie' ? 0.015 * t(actor, 'manipulation') : 0) +
        0.01 * t(target, 'empathy')
      );
    case 'covert':
      return 0.5 + 0.03 * t(actor, 'manipulation') - 0.02 * t(target, 'manipulation');
    case 'contest':
      return (
        0.03 * (t(actor, 'competitiveness') - t(target, 'competitiveness')) +
        0.02 * ((actor?.stats.energy ?? 50) - (target?.stats.energy ?? 50))
      );
    case 'chance':
      return 0.2 + 0.01 * ((actor?.stats.energy ?? 50) - 50);
  }
}

export class HeuristicOutcomeModel implements OutcomeModel {
  /** Distribution des issues pour cette option, sans tirage (pure). */
  distribution(state: Readonly<SimState>, actorId: Id, option: ActionOption): Record<string, number> {
    const def = assertInCatalog(state, option.action);
    const stance = STANCE[def.id];
    const probs =
      def.outcomes.length === 1 || stance === undefined
        ? orderedLogit(0, def.outcomes.length)
        : orderedLogit(successScore(state, actorId, option, stance), def.outcomes.length);
    return Object.fromEntries(def.outcomes.map((o, i) => [o, probs[i] ?? 0]));
  }

  resolve(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): Promise<OutcomeResult> {
    try {
      return Promise.resolve(this.#draw(input));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  #draw(input: {
    readonly option: ActionOption;
    readonly actorId: Id;
    readonly state: Readonly<SimState>;
    readonly rng: Rng;
  }): OutcomeResult {
    const distribution = this.distribution(input.state, input.actorId, input.option);
    const outcomes = Object.keys(distribution);
    const last = outcomes[outcomes.length - 1];
    if (last === undefined) throw new DomainError('UNKNOWN_OUTCOME', `Aucune issue pour ${input.option.action}`);
    if (outcomes.length === 1) {
      return { outcome: last, distribution, rngDraw: null, policy: HEURISTIC_OUTCOME_POLICY };
    }
    const draw = input.rng.next();
    let cumulative = 0;
    let chosen = last;
    for (const o of outcomes) {
      cumulative += distribution[o] ?? 0;
      if (draw < cumulative) {
        chosen = o;
        break;
      }
    }
    return { outcome: chosen, distribution, rngDraw: draw, policy: HEURISTIC_OUTCOME_POLICY };
  }
}
