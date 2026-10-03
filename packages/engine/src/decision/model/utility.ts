/**
 * Utilité d'une option pour un personnage (decision-model.md §2) :
 *
 *   U = base + traits + relation + objectifs + agenda + directive + issue espérée − coût − habituation − répétition
 *
 * Tout est lu dans le `SimState` (jamais de hasard, jamais d'écriture) ; la décomposition est rendue terme à terme
 * pour la traçabilité et pour les tests.
 */
import { relOf } from '../../rules/preconditions.js';
import { actionDef } from '../../rules/catalog.js';
import { effectiveCost } from '../../rules/options.js';
import { dailyCount, habituationKey, ticksSinceLast } from '../../resolution/habituation.js';
import type { ActionOption } from '../ports.js';
import type { CharacterNode, Id, SimState } from '../../state/types.js';
import { ProbabilisticOutcomeModel } from './probabilistic-outcome.js';
import { expectedValence, hasUncertainOutcome } from './outcome-values.js';
import { PROFILES, type Profile } from './utility-profiles.js';
import { centered, clamp, weightsOf } from './weights.js';

export interface UtilityConfig {
  /** Poids de l'issue espérée (valence moyenne). Défaut 1,2, atténué par l'impulsivité (l'impulsif ignore le risque). */
  readonly outcomeWeight?: number;
  /** Pénalité par répétition du jour (même acteur, action, cible). Défaut 0,6. */
  readonly habituationPenalty?: number;
  /** Pénalité d'une répétition immédiate (même acteur, action, cible au tick précédent). Défaut 1, décroît sur `REPETITION_WINDOW` ticks. */
  readonly repetitionPenalty?: number;
  /** Modèle d'issues utilisé pour l'issue espérée. */
  readonly outcomes?: ProbabilisticOutcomeModel;
}

export interface UtilityBreakdown {
  readonly total: number;
  readonly terms: {
    readonly base: number;
    readonly traits: number;
    readonly relation: number;
    readonly goals: number;
    readonly agenda: number;
    readonly directive: number;
    readonly outcome: number;
    readonly cost: number;
    readonly habituation: number;
    readonly repetition: number;
  };
  /** Vrai si la directive interdit l'option (utilité `-Infinity`). */
  readonly forbidden: boolean;
}

/** Nombre de ticks au-delà duquel refaire la même action vers la même cible n'est plus une « répétition ». */
export const REPETITION_WINDOW = 6;

/** Pénalité de répétition : pleine si l'action vient d'être faite au tick précédent, nulle après `REPETITION_WINDOW` ticks. */
function repetitionTerm(state: Readonly<SimState>, actorId: Id, option: ActionOption, penalty: number): number {
  if (option.targetId === null) return 0;
  const gap = ticksSinceLast(state, actorId, option.action, option.targetId);
  if (gap === null || gap < 1 || gap > REPETITION_WINDOW) return 0;
  return -penalty * (1 - (gap - 1) / REPETITION_WINDOW);
}

const DEFAULT_OUTCOMES = new ProbabilisticOutcomeModel();

/** Affinité −1..+1 entre l'acteur et la cible : confiance, affection, alliance dans les deux sens, moins la rivalité. */
export function affinity(state: Readonly<SimState>, actorId: Id, targetId: Id): number {
  const ab = relOf(state, actorId, targetId);
  const ba = relOf(state, targetId, actorId);
  return clamp(
    0.3 * ((ab.trust - 50) / 50) +
      0.25 * (ab.affection / 100) +
      0.15 * (ab.alliance / 100) +
      0.15 * ((ba.trust - 50) / 50) +
      0.15 * (ba.affection / 100) -
      0.25 * (Math.max(ab.rivalry, ba.rivalry) / 100),
    -1,
    1,
  );
}

/** Familiarité 0..1 : d'inconnus à proches. */
const familiarity = (state: Readonly<SimState>, actorId: Id, targetId: Id): number => {
  const e = relOf(state, actorId, targetId);
  return e.acquaintance === 'close' ? 1 : e.acquaintance === 'acquainted' ? 0.7 : e.acquaintance === 'met' ? 0.35 : 0;
};

function traitTerm(p: Profile, w: ReturnType<typeof weightsOf>): number {
  return (
    (p.coop ?? 0) * centered(w.cooperationBias) +
    (p.decep ?? 0) * centered(w.deceptionBias) +
    (p.rival ?? 0) * centered(w.rivalryDrive) +
    (p.ambition ?? 0) * centered(w.ambitionDrive) +
    (p.social ?? 0) * centered(w.socialInitiative) +
    (p.influence ?? 0) * centered(w.influenceSeeking) +
    (p.react ?? 0) * centered(w.reactivity)
  );
}

function relationTerm(state: Readonly<SimState>, actorId: Id, option: ActionOption, p: Profile): number {
  const t = option.targetId;
  if (t === null || state.characters[t] === undefined) return 0;
  const ab = relOf(state, actorId, t);
  const ba = relOf(state, t, actorId);
  const w = weightsOf(state.characters[actorId] ?? { traits: {} });
  const closeness = Math.max(ab.alliance, ba.alliance) / 100;
  return (
    (p.rel ?? 0) * affinity(state, actorId, t) +
    (p.riv ?? 0) * (Math.max(ab.rivalry, ba.rivalry) / 100) +
    (p.stranger ?? 0) * (1 - familiarity(state, actorId, t)) +
    (p.attr ?? 0) * (ab.attraction / 100) +
    (p.ally ?? 0) * centered(w.allyBonus) * (0.4 + 0.6 * closeness)
  );
}

function goalsTerm(actor: Readonly<CharacterNode>, option: ActionOption, p: Profile): number {
  let sum = 0;
  for (const g of actor.goals) {
    if (g.status !== 'open') continue;
    if (g.targetCharacterId !== null && g.targetCharacterId === option.targetId)
      sum += 0.5 + ((p.rival ?? 0) > 0 ? 0.4 : 0);
    if (g.kind === 'main' && ((p.ambition ?? 0) > 0 || (p.influence ?? 0) > 0)) sum += 0.25;
  }
  return Math.min(sum, 1);
}

function agendaTerm(actor: Readonly<CharacterNode>, option: ActionOption): number {
  let sum = 0;
  for (const i of actor.agenda) {
    if (i.targetId === null || i.targetId !== option.targetId) continue;
    if (i.kind === 'talk_to') sum += i.priority;
    else if (i.kind === 'avoid') sum -= 1.5 * i.priority;
    else if (i.kind === 'tell' && option.action === 'share_secret' && i.factId === option.factId) sum += 2 * i.priority;
  }
  return sum;
}

function directiveTerm(actor: Readonly<CharacterNode>, option: ActionOption): { value: number; forbidden: boolean } {
  const d = actor.directive;
  if (!d) return { value: 0, forbidden: false };
  if (d.forbid.includes(option.action)) return { value: 0, forbidden: true };
  const value =
    (d.actions[option.action] ?? 0) +
    (option.targetId === null ? 0 : (d.targets[option.targetId] ?? 0)) +
    (d.prefer.includes(option.action) ? 1 : 0);
  return { value, forbidden: false };
}

export function utilityBreakdown(
  state: Readonly<SimState>,
  actorId: Id,
  option: ActionOption,
  config: UtilityConfig = {},
): UtilityBreakdown {
  const actor = state.characters[actorId];
  const def = actionDef(option.action);
  const profile = PROFILES[def?.id ?? 'deflect'];
  const zero = {
    base: 0,
    traits: 0,
    relation: 0,
    goals: 0,
    agenda: 0,
    directive: 0,
    outcome: 0,
    cost: 0,
    habituation: 0,
    repetition: 0,
  };
  if (!actor || !def) return { total: -Infinity, terms: zero, forbidden: false };

  const w = weightsOf(actor);
  const fatigue = clamp((100 - actor.stats.energy) / 100, 0, 1);
  const directive = directiveTerm(actor, option);

  const cost = effectiveCost(state, def);
  const energyCost = cost.energy > 0 ? -0.06 * cost.energy * (1 + (100 - actor.stats.energy) / 50) : 0;
  const creditCost = cost.credits > 0 ? -2 * (cost.credits / Math.max(1, actor.credits)) : 0;

  const distribution = (config.outcomes ?? DEFAULT_OUTCOMES).distribution(state, actorId, option);
  // Prudence : l'impulsif ignore une partie du risque.
  const caution = 1 - 0.5 * w.reactivity;

  const terms = {
    base: profile.base,
    traits: traitTerm(profile, w) + (profile.fatigue ?? 0) * fatigue,
    relation: relationTerm(state, actorId, option, profile),
    goals: goalsTerm(actor, option, profile),
    agenda: agendaTerm(actor, option),
    directive: directive.value,
    outcome: hasUncertainOutcome(option.action)
      ? (config.outcomeWeight ?? 1.2) * caution * expectedValence(option.action, distribution)
      : 0,
    cost: energyCost + creditCost,
    habituation:
      -(config.habituationPenalty ?? 0.6) * dailyCount(state, habituationKey(actorId, option.action, option.targetId)),
    repetition: repetitionTerm(state, actorId, option, config.repetitionPenalty ?? 1),
  };
  const total = directive.forbidden ? -Infinity : Object.values(terms).reduce((s, v) => s + v, 0);
  return { total, terms, forbidden: directive.forbidden };
}

/** Utilité totale (`-Infinity` si la directive interdit l'option). */
export const utilityOf = (
  state: Readonly<SimState>,
  actorId: Id,
  option: ActionOption,
  config?: UtilityConfig,
): number => utilityBreakdown(state, actorId, option, config).total;

/** Bonus de l'agenda propre à un fait : l'intention « raconter F à X » relève `share_secret(X, F)` de deux fois sa priorité. */
const tellBonus = (state: Readonly<SimState>, actorId: Id, option: ActionOption): number =>
  option.action !== 'share_secret' || option.factId === null
    ? 0
    : (state.characters[actorId]?.agenda ?? [])
        .filter((i) => i.kind === 'tell' && i.targetId === option.targetId && i.factId === option.factId)
        .reduce((sum, i) => sum + 2 * i.priority, 0);

const groupKey = (o: ActionOption): string => `${o.action}|${o.targetId ?? ''}|${o.itemId ?? ''}|${o.locationId ?? ''}`;

/**
 * Utilités de plusieurs options d'un même acteur, et taille du groupe de chaque option. Les options qui ne diffèrent que
 * par le fait (`share_secret` × N faits) forment un groupe : elles partagent le même calcul, seul le bonus d'agenda
 * propre au fait s'y ajoute. Même résultat que `utilityOf` option par option.
 */
export function utilitiesOf(
  state: Readonly<SimState>,
  actorId: Id,
  options: readonly ActionOption[],
  config?: UtilityConfig,
): { utilities: number[]; groupSizes: number[] } {
  const base = new Map<string, number>();
  const size = new Map<string, number>();
  for (const option of options) {
    const key = groupKey(option);
    size.set(key, (size.get(key) ?? 0) + 1);
    if (!base.has(key)) base.set(key, utilityOf(state, actorId, { ...option, factId: null }, config));
  }
  return {
    utilities: options.map((o) => (base.get(groupKey(o)) ?? -Infinity) + tellBonus(state, actorId, o)),
    groupSizes: options.map((o) => size.get(groupKey(o)) ?? 1),
  };
}
