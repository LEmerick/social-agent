/**
 * Propagation simulée d'un fait le long des arêtes (action-catalog.md §9.1) et réactions des informés.
 * La probabilité qu'un informé B raconte le fait à C suit une logistique sur l'arête B → C :
 *
 *   logit = −1,5 + 0,03 × confiance(B→C) + 0,015 × affection(B→C) + 0,01 × alliance(B→C)
 *           − 2 × loyauté(B) × alliance(B→source) + 0,45 × sensibilité + 0,6 × (sociabilité(B) − 50) / 50
 *
 * (loyauté et alliances ramenées à 0..1). Un informé de seconde main qui n'est pas le sujet peut aussi réagir
 * en confrontant le sujet : la probabilité vient de l'utilité rapide de `confront` (softmax contre « ne rien faire »).
 */
import { NEUTRAL_TRAIT } from '../../character/compile.js';
import { relOf } from '../../rules/preconditions.js';
import type { Id, SimState } from '../../state/types.js';
import type { ActionOption } from '../ports.js';
import { softmax, temperatureOf } from './softmax.js';
import type { UtilityConfig } from './utility.js';
import { utilityOf } from './utility.js';
import { weightsOf } from './weights.js';

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function tellProbability(
  state: Readonly<SimState>,
  fromId: Id,
  toId: Id,
  sourceId: Id,
  sensitivity: number,
): number {
  const e = relOf(state, fromId, toId);
  const loyalty = (state.characters[fromId]?.traits['loyalty'] ?? NEUTRAL_TRAIT) / 100;
  const sociability = (state.characters[fromId]?.traits['sociability'] ?? NEUTRAL_TRAIT) - 50;
  const logit =
    -1.5 +
    0.03 * e.trust +
    0.015 * e.affection +
    0.01 * e.alliance -
    2 * loyalty * (relOf(state, fromId, sourceId).alliance / 100) +
    0.45 * sensitivity +
    0.6 * (sociability / 50);
  return sigmoid(logit);
}

/** Probabilité que `reactorId`, informé d'un fait de gravité `sensitivity` sur `aboutId`, le confronte. */
export function reactionProbability(
  state: Readonly<SimState>,
  reactorId: Id,
  aboutId: Id,
  sensitivity: number,
  utility?: UtilityConfig,
): number {
  const reactor = state.characters[reactorId];
  if (!reactor) return 0;
  const option: ActionOption = { action: 'confront', targetId: aboutId, factId: null, itemId: null, locationId: null };
  const u = utilityOf(state, reactorId, option, utility) + 0.8 * (sensitivity / 3);
  return softmax([u, 0], temperatureOf(weightsOf(reactor).reactivity))[0] ?? 0;
}
