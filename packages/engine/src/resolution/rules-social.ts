/** Règles des actions sociales et relationnelles. `a` = acteur, `b` = cible ; `ba` = relation de la cible vers l'acteur. */
import { m, trait, traitB, type RuleSet } from './kit.js';

export const SOCIAL_RULES = {
  small_talk: {
    accepted: (c, k) => [
      k.ba('trust', 1 + m(traitB(c, 'empathy'), 0.02)),
      k.ba('affection', 1 + m(traitB(c, 'sociability'), 0.02)),
      k.ab('affection', 1),
      k.a.score('social', 1),
      k.b.score('social', 1),
    ],
    deflected: (_c, k) => [k.ba('affection', -0.5)],
    refused: (_c, k) => [k.ba('affection', -1.5), k.ab('affection', -0.5)],
  },
  compliment: {
    accepted: (c, k) => [
      k.ba('affection', 2 + m(trait(c.a, 'charisma'), 0.04)),
      k.ba('trust', 1),
      k.ab('affection', 0.5),
      k.b.mood('joy', 1),
      k.a.score('social', 1),
    ],
    deflected: (_c, k) => [k.ba('trust', -0.5)],
    refused: (_c, k) => [k.ba('affection', -1), k.ba('trust', -1)],
    backfired: (_c, k) => [k.ba('trust', -3), k.ba('respect', -2), k.a.score('drama', 1)],
  },
  confide: {
    accepted: (c, k) => [
      k.ba('trust', 4 + m(traitB(c, 'empathy'), 0.06)),
      k.ba('affection', 3),
      k.ab('trust', 3),
      k.ab('affection', 2),
      k.a.score('social', 2),
      k.b.score('social', 2),
    ],
    deflected: (_c, k) => [k.ab('trust', -1)],
    refused: (_c, k) => [k.ab('trust', -4), k.ab('affection', -2), k.a.mood('shame', 1)],
    backfired: (_c, k) => [k.ab('trust', -8), k.ba('respect', -3), k.a.score('drama', 2)],
  },
  comfort: {
    accepted: (c, k) => [
      k.ba('affection', 3 + m(trait(c.a, 'empathy'), 0.05)),
      k.ba('trust', 3),
      k.b.stat('morale', 4),
      k.a.stat('morale', 1),
      k.a.score('social', 2),
    ],
    deflected: (_c, k) => [k.b.stat('morale', 1)],
    refused: (_c, k) => [k.ba('affection', -1)],
  },
  probe: {
    accepted: (_c, k) => [k.ab('trust', 1), k.ba('trust', 0.5)],
    deflected: (_c, k) => [k.ab('trust', -1)],
    refused: (_c, k) => [k.ba('trust', -2), k.ab('affection', -1)],
    backfired: (_c, k) => [k.ba('trust', -5), k.ba('rivalry', 3), k.a.score('drama', 1)],
  },
  flirt: {
    accepted: (c, k) => [
      k.ba('attraction', 4 + m(trait(c.a, 'charisma'), 0.06)),
      k.ba('affection', 3),
      k.ab('attraction', 2),
      k.a.mood('joy', 1),
      k.a.score('social', 1),
    ],
    deflected: (_c, k) => [k.ab('affection', -0.5)],
    refused: (_c, k) => [k.ab('attraction', -2), k.ba('affection', -1)],
    backfired: (_c, k) => [
      k.ba('respect', -4),
      k.ba('affection', -3),
      k.a.stat('reputation', -1),
      k.a.score('drama', 1),
    ],
  },
  express_feelings: {
    accepted: (_c, k) => [
      k.ba('affection', 6),
      k.ba('attraction', 4),
      k.ba('trust', 3),
      k.ab('trust', 2),
      k.a.stat('morale', 3),
      k.a.score('social', 3),
      k.b.score('social', 3),
    ],
    deflected: (_c, k) => [k.a.stat('morale', -2), k.ab('trust', -1)],
    refused: (_c, k) => [k.a.stat('morale', -5), k.ab('affection', -4), k.ba('affection', -1)],
    backfired: (_c, k) => [
      k.ba('respect', -3),
      k.a.stat('morale', -6),
      k.a.stat('reputation', -1),
      k.a.score('drama', 2),
    ],
  },
  apologize: {
    accepted: (c, k) => [
      k.ba('trust', 4 + m(traitB(c, 'empathy'), 0.05)),
      k.ba('rivalry', -5),
      k.ba('affection', 2),
      k.a.stat('morale', 2),
    ],
    accepted_conditional: (_c, k) => [k.ba('trust', 2), k.ba('rivalry', -2)],
    deflected: (_c, k) => [k.ba('rivalry', -0.5)],
    refused: (_c, k) => [k.ba('rivalry', 1), k.a.stat('morale', -2)],
  },
} satisfies Record<string, RuleSet>;
