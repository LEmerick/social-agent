/**
 * Coefficients des logistiques d'issue (`probabilistic@1`), par action (decision-model.md §4).
 *
 * Score de réussite de l'acteur `s = biais + Σ coefficient × valeur centrée`, où les axes sont ceux de l'arête
 * **cible → acteur** (confiance et respect centrés sur 50 et ramenés à −1..+1 ; affection −1..+1 ; autres axes 0..1)
 * et les traits centrés sur 50 (−1..+1). Les signes sont fixés par action : le score est affine et monotone dans
 * chaque axe, donc P(issue la plus favorable) l'est aussi (`orderedLogit` est monotone en `s`).
 */
import type { TraitKey } from '../../character/compile.js';
import type { ActionId } from '../../rules/types.js';

export interface Coeffs {
  readonly bias: number;
  readonly trust?: number;
  readonly affection?: number;
  readonly rivalry?: number;
  readonly alliance?: number;
  readonly fear?: number;
  readonly respect?: number;
  readonly attraction?: number;
  /** Écart d'énergie acteur − cible, ramené à −1..+1. */
  readonly energyGap?: number;
  readonly actor?: Readonly<Partial<Record<TraitKey, number>>>;
  readonly target?: Readonly<Partial<Record<TraitKey, number>>>;
}

const COOP: Coeffs = {
  bias: 0.9,
  trust: 1.6,
  affection: 0.9,
  alliance: 0.7,
  rivalry: -1.1,
  respect: 0.3,
  actor: { charisma: 0.5 },
  target: { empathy: 0.3 },
};

const HOSTILE: Coeffs = {
  bias: 0.2,
  rivalry: 1.2,
  trust: -0.5,
  actor: { charisma: 0.4 },
  target: { impulsivity: 1.0 },
};

const PRESSURE: Coeffs = {
  bias: 0.1,
  fear: 1.2,
  respect: 0.6,
  trust: 0.5,
  rivalry: -0.6,
  actor: { charisma: 0.5 },
  target: { manipulation: -0.4 },
};

const BELIEF: Coeffs = {
  bias: 0.8,
  trust: 2.0,
  respect: 0.4,
  affection: 0.4,
  target: { empathy: 0.2 },
};

const COVERT: Coeffs = {
  bias: 0.4,
  trust: 0.4,
  actor: { manipulation: 1.0 },
  target: { manipulation: -0.6, empathy: -0.3 },
};

const BY_ACTION: Readonly<Partial<Record<ActionId, Coeffs>>> = {
  small_talk: { ...COOP, bias: 1.4 },
  compliment: COOP,
  confide: { ...COOP, trust: 2.0 },
  comfort: { ...COOP, bias: 1.2, target: { empathy: 0.6 } },
  probe: { ...COOP, bias: 0.6, trust: 1.8 },
  flirt: { ...COOP, bias: 0.1, attraction: 1.8, affection: 1.4 },
  express_feelings: { ...COOP, bias: 0, attraction: 1.2, affection: 1.8 },
  apologize: { ...COOP, bias: 1.0, rivalry: -0.8, target: { empathy: 0.7 } },
  provoke: HOSTILE,
  insult: { ...HOSTILE, bias: 0 },
  propose_alliance: {
    bias: 1.6,
    trust: 1.8,
    affection: 0.6,
    alliance: 0.8,
    respect: 0.8,
    rivalry: -1.5,
    actor: { charisma: 0.6 },
    target: { ambition: 0.3 },
  },
  // Rompre : la cible qui tient à nous (alliance, affection, loyauté) réagit mal, l'impulsive explose.
  break_alliance: {
    bias: 0.6,
    alliance: -1.2,
    affection: -0.8,
    trust: -0.4,
    target: { loyalty: -0.6, impulsivity: -0.8 },
  },
  request_favor: { ...COOP, bias: 0.4, alliance: 1.0 },
  negotiate_vote: { ...COOP, bias: 0.2, alliance: 1.2, trust: 1.4 },
  share_secret: BELIEF,
  spread_rumor: { ...BELIEF, bias: 0.4, actor: { manipulation: 0.4 } },
  lie: { ...BELIEF, bias: 0.3, actor: { manipulation: 0.8 }, target: { manipulation: -0.5, empathy: -0.4 } },
  deflect: { bias: 0.5, actor: { charisma: 0.5 }, trust: 0.4 },
  confront: PRESSURE,
  accuse: { ...PRESSURE, bias: 0 },
  threaten: { ...PRESSURE, bias: -0.1, fear: 1.6 },
  challenge: { bias: 0, energyGap: 2, actor: { competitiveness: 1.0 }, target: { competitiveness: -1.0 } },
  sabotage: COVERT,
  eavesdrop: { ...COVERT, bias: 0.6 },
  steal: { ...COVERT, bias: 0.2 },
  hide: { ...COVERT, bias: 0.8 },
  fake_item: { ...COVERT, bias: 0.3 },
  spy_camp: { ...COVERT, bias: 0.3 },
  join_activity: { bias: 1.5, actor: { sociability: 0.4 } },
  give: { ...COOP, bias: 1.4 },
  trade: { ...COOP, bias: 0.6, trust: 1.8 },
  search: { bias: 0.1, energyGap: 0 },
  use_item: { bias: 1.0 },
};

const NEUTRAL: Coeffs = { bias: 0 };

export const coeffsOf = (action: string): Coeffs => BY_ACTION[action as ActionId] ?? NEUTRAL;
