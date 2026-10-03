/** Règles des actions compétitives et des actions spéciales. `ab` = acteur→cible, `ba` = cible→acteur. */
import { m, scaled, trait, traitB, type RuleSet } from './kit.js';

const PROVOKE: RuleSet = {
  escalated: (c, k) => [
    k.ba('rivalry', 6 + m(traitB(c, 'competitiveness'), 0.08)),
    k.ba('affection', -4),
    k.ab('rivalry', 3),
    k.ba('respect', -2),
    k.b.stat('morale', -2),
    k.a.score('drama', 3),
    k.b.score('drama', 2),
  ],
  deflected: (_c, k) => [k.ba('respect', -1), k.a.score('drama', 1)],
  backfired: (_c, k) => [
    k.a.stat('reputation', -2),
    k.ba('rivalry', 2),
    k.ab('respect', 2),
    k.a.stat('morale', -3),
    k.a.score('drama', 1),
  ],
};

const CONFRONT: RuleSet = {
  escalated: (_c, k) => [
    k.ba('rivalry', 8),
    k.ab('rivalry', 6),
    k.ba('trust', -8),
    k.ab('trust', -8),
    k.ba('affection', -5),
    k.a.mood('anger', 3),
    k.b.mood('anger', 3),
    k.a.score('drama', 3),
    k.b.score('drama', 3),
  ],
  accepted: (_c, k) => [
    k.ab('rivalry', -2),
    k.ba('respect', 2),
    k.ba('trust', -1),
    k.b.stat('morale', -2),
    k.a.score('influence', 2),
  ],
  deflected: (_c, k) => [k.ab('trust', -3), k.ab('rivalry', 2)],
  backfired: (_c, k) => [k.ba('respect', -4), k.a.stat('reputation', -2), k.ba('rivalry', 5), k.a.score('drama', 2)],
};

export const CONFLICT_RULES = {
  provoke: PROVOKE,
  insult: scaled(PROVOKE, 1.4),
  confront: CONFRONT,
  accuse: scaled(CONFRONT, 1.3),
  threaten: {
    accepted: (c, k) => [
      k.ba('fear', 8 + m(trait(c.a, 'charisma'), 0.06)),
      k.ba('trust', -6),
      k.ba('affection', -4),
      k.ab('respect', -1),
      k.a.score('influence', 2),
    ],
    refused: (_c, k) => [k.ba('rivalry', 5), k.ba('respect', -3), k.ba('fear', 2)],
    escalated: (_c, k) => [
      k.ba('rivalry', 10),
      k.ab('rivalry', 6),
      k.ba('trust', -10),
      k.ba('fear', 4),
      k.a.score('drama', 4),
      k.b.score('drama', 3),
    ],
    backfired: (_c, k) => [k.ba('fear', -3), k.a.stat('reputation', -3), k.ba('rivalry', 6), k.a.score('drama', 2)],
  },
  challenge: {
    won: (_c, k) => [
      k.a.stat('popularity', 2),
      k.a.stat('morale', 3),
      k.b.stat('morale', -3),
      k.ba('respect', 3),
      k.ba('rivalry', 3),
      k.a.score('popularity', 3),
      k.a.score('drama', 1),
    ],
    lost: (_c, k) => [
      k.b.stat('popularity', 2),
      k.b.stat('morale', 3),
      k.a.stat('morale', -3),
      k.ab('respect', 3),
      k.ab('rivalry', 3),
      k.b.score('popularity', 3),
      k.b.score('drama', 1),
    ],
    draw: (_c, k) => [k.ab('respect', 2), k.ba('respect', 2), k.a.score('drama', 1), k.b.score('drama', 1)],
  },
  // Le coût de 10 crédits est prélevé par `chargeAction`, pas par la règle.
  sabotage: {
    undetected: (_c, k) => [k.b.stat('morale', -3), k.a.score('influence', 2)],
    detected: (_c, k) => [
      k.ba('trust', -20),
      k.ba('rivalry', 15),
      k.ba('respect', -8),
      k.a.stat('reputation', -5),
      k.a.score('drama', 4),
      k.b.score('drama', 2),
    ],
  },
} satisfies Record<string, RuleSet>;
