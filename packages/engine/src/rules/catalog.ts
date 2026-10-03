/**
 * Catalogue fermé et versionné des actions (action-catalog.md §2).
 * Le moteur refuse toute action hors catalogue (`assertInCatalog`).
 */
import { DomainError } from '../core/errors.js';
import type { SimState } from '../state/types.js';
import { OUTCOMES_BY_ACTION } from './outcomes.js';
import { PRE } from './preconditions.js';
import type { ActionCategory, ActionDef, ActionId, ActionTarget, ActionVolume, Precondition } from './types.js';
import { ACTION_IDS } from './types.js';

/** Version du catalogue : à incrémenter quand une action ou une issue change. */
export const CATALOG_VERSION = 1;

type Spec = readonly [
  id: ActionId,
  category: ActionCategory,
  target: ActionTarget,
  pre: Precondition,
  cost: ActionDef['cost'],
  volume: ActionVolume,
  gated?: boolean,
];

const SPECS: readonly Spec[] = [
  ['small_talk', 'social', 'character', PRE.scene, { energy: 1 }, 'normal'],
  ['compliment', 'social', 'character', PRE.scene, { energy: 1 }, 'normal'],
  ['confide', 'social', 'character', PRE.confide, { energy: 2 }, 'whisper'],
  ['comfort', 'social', 'character', PRE.comfort, { energy: 2 }, 'normal'],
  ['probe', 'informational', 'character', PRE.scene, { energy: 1 }, 'normal'],
  ['flirt', 'relational', 'character', PRE.scene, { energy: 2 }, 'normal'],
  ['express_feelings', 'relational', 'character', PRE.expressFeelings, { energy: 2 }, 'whisper'],
  ['apologize', 'relational', 'character', PRE.apologize, { energy: 1 }, 'normal'],
  ['provoke', 'competitive', 'character', PRE.scene, { energy: 2 }, 'loud'],
  ['insult', 'competitive', 'character', PRE.scene, { energy: 2 }, 'loud'],
  ['propose_alliance', 'strategic', 'character', PRE.proposeAlliance, { energy: 2 }, 'whisper'],
  ['break_alliance', 'strategic', 'character', PRE.breakAlliance, { energy: 2 }, 'normal'],
  ['request_favor', 'strategic', 'character', PRE.scene, { energy: 1 }, 'normal'],
  ['negotiate_vote', 'strategic', 'character', PRE.negotiateVote, { energy: 2 }, 'whisper', true],
  ['share_secret', 'informational', 'character', PRE.shareSecret, { energy: 1 }, 'whisper'],
  ['spread_rumor', 'informational', 'character', PRE.spreadRumor, { energy: 1 }, 'whisper'],
  ['lie', 'informational', 'character', PRE.lie, { energy: 1 }, 'normal'],
  ['deflect', 'informational', 'character', PRE.scene, {}, 'normal'],
  ['confront', 'competitive', 'character', PRE.confront, { energy: 3 }, 'loud'],
  ['accuse', 'competitive', 'character', PRE.confront, { energy: 3 }, 'loud'],
  ['threaten', 'competitive', 'character', PRE.scene, { energy: 2 }, 'whisper'],
  ['challenge', 'competitive', 'character', PRE.challenge, { energy: 4 }, 'loud'],
  ['sabotage', 'special', 'character', PRE.sabotage, { credits: 10 }, 'hidden'],
  ['move_to', 'movement', 'location', PRE.moveTo, {}, 'normal'],
  ['avoid', 'movement', 'character', PRE.anyCharacter, {}, 'normal'],
  ['eavesdrop', 'observation', 'character', PRE.eavesdrop, { energy: 1 }, 'hidden'],
  ['join_activity', 'collective', 'slot', PRE.joinActivity, { credits: 3 }, 'normal'],
  ['rest', 'solo', 'none', PRE.always, { energy: -10 }, 'normal'],
  ['search', 'object', 'location', PRE.here, { energy: 3 }, 'normal', true],
  ['pick_up', 'object', 'none', PRE.pickUp, {}, 'normal', true],
  ['give', 'object', 'character', PRE.give, {}, 'normal', true],
  ['trade', 'object', 'character', PRE.give, {}, 'normal', true],
  ['steal', 'object', 'character', PRE.steal, { energy: 2 }, 'hidden', true],
  ['hide', 'object', 'location', PRE.hide, { energy: 1 }, 'hidden', true],
  ['show_item', 'object', 'characters', PRE.showItem, {}, 'normal', true],
  ['use_item', 'object', 'none', PRE.useItem, {}, 'normal', true],
  ['fake_item', 'object', 'none', PRE.always, { energy: 3 }, 'hidden', true],
  ['cast_vote', 'collective', 'character', PRE.castVote, {}, 'normal', true],
  ['spy_camp', 'observation', 'location', PRE.spyCamp, { energy: 3 }, 'hidden', true],
];

export const ACTION_CATALOG: Readonly<Record<ActionId, ActionDef>> = Object.fromEntries(
  SPECS.map(([id, category, target, preconditions, cost, defaultVolume, gated]) => [
    id,
    {
      id,
      category,
      target,
      preconditions,
      cost,
      defaultVolume,
      outcomes: OUTCOMES_BY_ACTION[id],
      version: 1,
      gated: gated ?? false,
    } satisfies ActionDef,
  ]),
) as Record<ActionId, ActionDef>;

export const isActionId = (action: string): action is ActionId => (ACTION_IDS as readonly string[]).includes(action);

/** Définition d'une action, ou `undefined` hors catalogue. */
export const actionDef = (action: string): ActionDef | undefined =>
  isActionId(action) ? ACTION_CATALOG[action] : undefined;

/** Une action gardée n'existe que si la saison l'active. */
export const isEnabled = (state: Readonly<SimState>, def: ActionDef): boolean =>
  !def.gated || state.season.rules.enabledActions.includes(def.id);

/** Refuse toute action hors catalogue ou non activée par la saison ; renvoie sa définition. */
export function assertInCatalog(state: Readonly<SimState>, action: string): ActionDef {
  const def = actionDef(action);
  if (!def) throw new DomainError('UNKNOWN_ACTION', `Action hors catalogue : ${action}`);
  if (!isEnabled(state, def)) {
    throw new DomainError('ACTION_DISABLED', `Action non activée par la saison : ${action}`);
  }
  return def;
}

/** Action payante : interdite en `restricted` (engine-architecture.md §10). */
export const isPaidAction = (def: ActionDef): boolean => (def.cost.credits ?? 0) > 0 || def.category === 'special';
