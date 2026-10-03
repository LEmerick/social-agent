/**
 * Règles des déplacements, observations, activités et objets.
 * Les effets sur les inventaires, équipes et missions (M7) passent par les events ; ici seuls les effets
 * sociaux et d'état sont produits.
 */
import { scaled, type RuleSet } from './kit.js';

const GIVE: RuleSet = {
  accepted: (_c, k) => [k.ba('trust', 2), k.ba('affection', 3), k.ab('affection', 1)],
  refused: (_c, k) => [k.ab('affection', -1)],
};

export const MISC_RULES = {
  move_to: { accepted: () => [] },
  avoid: { accepted: () => [] },
  eavesdrop: {
    undetected: () => [],
    detected: (_c, k) => [k.ba('trust', -8), k.ba('respect', -3), k.a.stat('reputation', -1)],
  },
  join_activity: {
    accepted: (_c, k) => [k.a.stat('morale', 2), k.a.score('social', 1)],
    refused: (_c, k) => [k.a.stat('morale', -1)],
  },
  rest: { accepted: (_c, k) => [k.a.stat('morale', 1)] },
  search: {
    found: (_c, k) => [k.a.stat('morale', 2)],
    found_clue: (_c, k) => [k.a.stat('morale', 1), k.a.score('influence', 1)],
    not_found: (_c, k) => [k.a.stat('morale', -1)],
  },
  pick_up: { accepted: () => [] },
  give: GIVE,
  trade: scaled(GIVE, 0.6),
  steal: {
    undetected: (_c, k) => [k.a.score('influence', 1)],
    detected: (_c, k) => [
      k.ba('trust', -25),
      k.ba('rivalry', 15),
      k.ba('respect', -10),
      k.a.stat('reputation', -5),
      k.a.score('drama', 4),
    ],
  },
  hide: {
    undetected: () => [],
    detected: (_c, k) => [k.a.stat('reputation', -1)],
  },
  show_item: { accepted: () => [] },
  use_item: {
    accepted: () => [],
    backfired: (_c, k) => [k.a.stat('morale', -2)],
  },
  fake_item: {
    undetected: (_c, k) => [k.a.score('influence', 1)],
    detected: (_c, k) => [k.a.stat('reputation', -4), k.a.score('drama', 2)],
  },
  cast_vote: { accepted: () => [] },
  spy_camp: {
    undetected: (_c, k) => [k.a.score('influence', 1)],
    detected: (_c, k) => [k.a.stat('reputation', -3), k.a.score('drama', 2)],
  },
} satisfies Record<string, RuleSet>;
