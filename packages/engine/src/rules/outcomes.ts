/**
 * Vocabulaire d'issues par action (action-catalog.md §3).
 * L'ordre est significatif : de l'issue la plus favorable à l'acteur à la moins favorable.
 * `HeuristicOutcomeModel` s'en sert pour répartir les probabilités.
 */
import type { ActionId, OutcomeId } from './types.js';

const COOP: readonly OutcomeId[] = ['accepted', 'deflected', 'refused'];
const COOP_BACKFIRE: readonly OutcomeId[] = ['accepted', 'deflected', 'refused', 'backfired'];
const BELIEF: readonly OutcomeId[] = ['believed', 'doubted', 'disbelieved'];
const COVERT: readonly OutcomeId[] = ['undetected', 'detected'];
const DONE: readonly OutcomeId[] = ['accepted'];

export const OUTCOMES_BY_ACTION: Readonly<Record<ActionId, readonly OutcomeId[]>> = {
  small_talk: COOP,
  compliment: COOP_BACKFIRE,
  confide: COOP_BACKFIRE,
  comfort: COOP,
  probe: COOP_BACKFIRE,
  flirt: COOP_BACKFIRE,
  express_feelings: COOP_BACKFIRE,
  apologize: ['accepted', 'accepted_conditional', 'deflected', 'refused'],
  provoke: ['escalated', 'deflected', 'backfired'],
  insult: ['escalated', 'deflected', 'backfired'],
  propose_alliance: ['accepted', 'accepted_conditional', 'deflected', 'refused', 'backfired'],
  break_alliance: ['accepted', 'deflected', 'escalated'],
  request_favor: ['accepted', 'accepted_conditional', 'deflected', 'refused'],
  negotiate_vote: ['accepted', 'accepted_conditional', 'deflected', 'refused'],
  share_secret: BELIEF,
  spread_rumor: BELIEF,
  lie: ['believed', 'doubted', 'disbelieved', 'detected'],
  deflect: ['accepted', 'refused'],
  confront: ['accepted', 'deflected', 'escalated', 'backfired'],
  accuse: ['accepted', 'deflected', 'escalated', 'backfired'],
  threaten: ['accepted', 'refused', 'escalated', 'backfired'],
  challenge: ['won', 'draw', 'lost'],
  sabotage: COVERT,
  move_to: DONE,
  avoid: DONE,
  eavesdrop: COVERT,
  join_activity: ['accepted', 'refused'],
  rest: DONE,
  search: ['found', 'found_clue', 'not_found'],
  pick_up: DONE,
  give: ['accepted', 'refused'],
  trade: ['accepted', 'refused'],
  steal: COVERT,
  hide: COVERT,
  show_item: DONE,
  use_item: ['accepted', 'backfired'],
  fake_item: COVERT,
  cast_vote: DONE,
  spy_camp: COVERT,
};
