/** Règles des actions stratégiques et informationnelles. `ab` = acteur→cible, `ba` = cible→acteur. */
import { m, trait, traitB, type RuleSet } from './kit.js';

export const STRATEGIC_RULES = {
  // Exemple de référence (engine-architecture.md §9), modulé par l'empathie et la loyauté de la cible
  // et par la confiance qu'elle a déjà en l'acteur.
  propose_alliance: {
    accepted: (c, k) => [
      k.ba('trust', 8 + traitB(c, 'empathy') / 25 + m(c.ba.trust, 0.05)),
      k.ab('trust', 5),
      k.ab('alliance', 20),
      k.ba('alliance', 15 + m(traitB(c, 'loyalty'), 0.1)),
      k.a.stat('influence', 4),
      k.a.mood('hope', 0.5),
      k.a.score('social', 6),
      k.b.score('social', 5),
    ],
    accepted_conditional: (c, k) => [
      k.ba('trust', 6 + traitB(c, 'empathy') / 25 + m(c.ba.trust, 0.05)),
      k.ab('trust', 4),
      k.ab('alliance', 15),
      k.ba('alliance', 10 + m(traitB(c, 'loyalty'), 0.1)),
      k.a.stat('influence', 3),
      k.a.mood('hope', 0.3),
      k.a.score('social', 5),
      k.b.score('social', 3),
    ],
    deflected: (_c, k) => [k.ab('trust', -0.5), k.a.stat('morale', -1)],
    refused: (_c, k) => [k.ba('trust', -1), k.ab('affection', -2), k.a.stat('morale', -2)],
    backfired: (_c, k) => [k.ba('trust', -6), k.ba('rivalry', 4), k.a.stat('reputation', -2), k.a.score('drama', 2)],
  },
  break_alliance: {
    accepted: (_c, k) => [
      k.ab('alliance', -60),
      k.ba('alliance', -40),
      k.ba('trust', -10),
      k.ba('affection', -5),
      k.ab('trust', -3),
      k.a.stat('reputation', -1),
      k.a.score('drama', 2),
      k.b.score('drama', 2),
    ],
    deflected: (_c, k) => [k.ab('alliance', -20), k.ba('alliance', -10), k.ba('trust', -4)],
    escalated: (_c, k) => [
      k.ab('alliance', -60),
      k.ba('alliance', -60),
      k.ba('trust', -15),
      k.ba('rivalry', 12),
      k.ab('rivalry', 6),
      k.a.stat('reputation', -2),
      k.a.score('drama', 4),
      k.b.score('drama', 4),
    ],
  },
  request_favor: {
    accepted: (_c, k) => [k.ab('trust', 3), k.ab('affection', 2), k.ba('trust', 1), k.a.score('influence', 1)],
    accepted_conditional: (_c, k) => [k.ab('trust', 1), k.a.score('influence', 1)],
    deflected: (_c, k) => [k.ab('respect', -0.5)],
    refused: (_c, k) => [k.ab('affection', -2), k.ab('trust', -1)],
  },
  negotiate_vote: {
    accepted: (_c, k) => [
      k.ab('alliance', 4),
      k.ba('alliance', 3),
      k.ba('trust', 2),
      k.a.stat('influence', 2),
      k.a.score('influence', 3),
    ],
    accepted_conditional: (_c, k) => [k.ba('alliance', 1), k.a.stat('influence', 1), k.a.score('influence', 1)],
    deflected: () => [],
    refused: (_c, k) => [k.ab('rivalry', 2)],
  },
  share_secret: {
    believed: (c, k) => [
      k.ba('trust', 6 + m(traitB(c, 'empathy'), 0.04)),
      k.ba('affection', 3),
      k.ab('trust', 3),
      k.a.score('social', 2),
      k.b.score('social', 2),
    ],
    doubted: (_c, k) => [k.ba('trust', 1), k.ab('trust', -2)],
    disbelieved: (_c, k) => [k.ba('trust', -4), k.ba('respect', -2), k.a.score('drama', 1)],
  },
  spread_rumor: {
    believed: (_c, k) => [k.ba('affection', 1), k.a.score('drama', 2)],
    doubted: (_c, k) => [k.ba('trust', -2)],
    disbelieved: (_c, k) => [k.ba('trust', -6), k.ba('respect', -4), k.a.stat('reputation', -2), k.a.score('drama', 1)],
  },
  lie: {
    believed: (_c, k) => [k.ba('trust', 1), k.a.score('influence', 1)],
    doubted: (_c, k) => [k.ba('trust', -3)],
    disbelieved: (_c, k) => [k.ba('trust', -6), k.ba('respect', -3)],
    // Un menteur habile (manipulation) perd un peu moins quand il est démasqué.
    detected: (c, k) => [
      k.ba('trust', -15 + m(trait(c.a, 'manipulation'), 0.05)),
      k.ba('respect', -8),
      k.ba('rivalry', 5),
      k.a.stat('reputation', -3),
      k.a.score('drama', 3),
    ],
  },
  deflect: {
    accepted: (_c, k) => [k.ba('trust', -0.5)],
    refused: (_c, k) => [k.ba('trust', -2), k.ba('rivalry', 1)],
  },
} satisfies Record<string, RuleSet>;
