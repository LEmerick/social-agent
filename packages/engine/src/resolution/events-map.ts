/** Correspondance `(action, issue)` → type d'event et importance narrative (0..1). */
import type { ActionId, OutcomeId } from '../rules/types.js';

const BASE_TYPE: Readonly<Record<ActionId, string>> = {
  small_talk: 'small_talk',
  compliment: 'compliment',
  confide: 'confided',
  comfort: 'comforted',
  probe: 'probed',
  flirt: 'flirted',
  express_feelings: 'feelings_expressed',
  apologize: 'apologized',
  provoke: 'provocation',
  insult: 'insult',
  propose_alliance: 'alliance_proposed',
  break_alliance: 'alliance_broken',
  request_favor: 'favor_requested',
  negotiate_vote: 'vote_negotiated',
  share_secret: 'secret_shared',
  spread_rumor: 'rumor_spread',
  lie: 'lie_told',
  deflect: 'deflected',
  confront: 'confrontation',
  accuse: 'accusation',
  threaten: 'threat',
  challenge: 'challenge_resolved',
  sabotage: 'sabotage',
  move_to: 'moved',
  avoid: 'avoided',
  eavesdrop: 'eavesdropped',
  join_activity: 'activity_joined',
  rest: 'rested',
  search: 'searched',
  pick_up: 'pick_up_done',
  give: 'give_done',
  trade: 'trade_done',
  steal: 'theft',
  hide: 'hide_done',
  show_item: 'show_item_done',
  use_item: 'use_item_done',
  fake_item: 'fake_item_done',
  cast_vote: 'vote_cast',
  spy_camp: 'camp_spied',
};

const OVERRIDES: Readonly<Record<string, string>> = {
  'propose_alliance:accepted': 'alliance_formed',
  'propose_alliance:deflected': 'alliance_declined',
  'propose_alliance:refused': 'alliance_declined',
  'propose_alliance:backfired': 'alliance_backfired',
  'lie:detected': 'lie_exposed',
  'sabotage:detected': 'sabotage_detected',
  'steal:detected': 'theft_detected',
  'eavesdrop:detected': 'eavesdrop_detected',
  'spy_camp:detected': 'camp_spy_detected',
  'fake_item:detected': 'item_fake_detected',
};

/** Les actions hostiles qui dégénèrent produisent toutes une `confrontation`. */
const HOSTILE: ReadonlySet<string> = new Set(['provoke', 'insult', 'confront', 'accuse', 'threaten']);

export function eventTypeFor(action: ActionId, outcome: OutcomeId): string {
  if (outcome === 'escalated' && HOSTILE.has(action)) return 'confrontation';
  return OVERRIDES[`${action}:${outcome}`] ?? BASE_TYPE[action];
}

const BASE_IMPORTANCE: Readonly<Record<ActionId, number>> = {
  small_talk: 0.1,
  compliment: 0.1,
  confide: 0.4,
  comfort: 0.3,
  probe: 0.15,
  flirt: 0.3,
  express_feelings: 0.55,
  apologize: 0.35,
  provoke: 0.4,
  insult: 0.45,
  propose_alliance: 0.6,
  break_alliance: 0.7,
  request_favor: 0.25,
  negotiate_vote: 0.5,
  share_secret: 0.6,
  spread_rumor: 0.5,
  lie: 0.4,
  deflect: 0.1,
  confront: 0.65,
  accuse: 0.7,
  threaten: 0.6,
  challenge: 0.5,
  sabotage: 0.7,
  move_to: 0.02,
  avoid: 0.05,
  eavesdrop: 0.3,
  join_activity: 0.2,
  rest: 0.02,
  search: 0.15,
  pick_up: 0.1,
  give: 0.25,
  trade: 0.25,
  steal: 0.65,
  hide: 0.15,
  show_item: 0.15,
  use_item: 0.2,
  fake_item: 0.4,
  cast_vote: 0.5,
  spy_camp: 0.45,
};

const OUTCOME_BONUS: Readonly<Partial<Record<OutcomeId, number>>> = {
  escalated: 0.2,
  backfired: 0.15,
  detected: 0.15,
  accepted: 0.05,
  found_clue: 0.1,
  deflected: -0.05,
  not_found: -0.05,
};

export function importanceFor(action: ActionId, outcome: OutcomeId): number {
  const v = BASE_IMPORTANCE[action] + (OUTCOME_BONUS[outcome] ?? 0);
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}
