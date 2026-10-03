/**
 * Fouille (game-formats.md §2.4) :
 * `P(found) = σ( a·énergie/100 + b·perspicacité − c·difficulté/100 + d·indices connus − e·fouilles déjà faites )`.
 * Le tirage vient du `Rng` fourni (déterministe) ; issue `found`, `found_clue` ou `not_found`.
 */
import type { Rng } from '../core/rng.js';
import type { Listener } from '../scene/audience.js';
import { NEUTRAL_TRAIT } from '../character/compile.js';
import { formatOf, type ItemNode } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import { findItem } from './inventory.js';
import { requireCharacter, requireLocation } from './inventory-core.js';
import { ITEM_AT, ensureFact, itemAtRef, witnessFact } from './item-knowledge.js';
import { emptyOutput, mergeOutput, type FormatContext, type FormatOutput } from './output.js';
import { recordAction } from './tracking.js';

/** Poids de la formule : énergie (a), perspicacité (b), difficulté (c), indices (d), fouilles passées (e). */
export const SEARCH_WEIGHTS = { energy: 1, insight: 1, difficulty: 3, clue: 1, prior: 0.3 } as const;

/** Trait de perspicacité (absent du catalogue de traits de base : neutre à 50 s'il n'est pas renseigné). */
export const INSIGHT_TRAIT = 'insight';

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export interface SearchOutcome extends FormatOutput {
  readonly outcome: 'found' | 'found_clue' | 'not_found';
  readonly itemId: Id | null;
  /** Probabilité de la dernière tentative tirée (0 si rien à trouver). */
  readonly probability: number;
  readonly draw: number | null;
  readonly items: ItemNode[];
}

/** Indices connus de `actorId` sur l'emplacement de `item` (faits `item_at`, non rejetés). */
export function knownClues(state: Readonly<SimState>, actorId: Id, itemId: Id): number {
  const prefix = itemAtRef(itemId, '');
  return Object.values(state.knowledge).filter((k) => {
    if (k.characterId !== actorId || k.belief === 'disbelieves') return false;
    const fact = state.facts[k.factId];
    return fact?.predicate === ITEM_AT && (fact.objectText?.startsWith(prefix) ?? false);
  }).length;
}

export function searchProbability(
  state: Readonly<SimState>,
  actorId: Id,
  item: ItemNode,
  priorSearches: number,
): number {
  const c = state.characters[actorId];
  const energy = (c?.stats.energy ?? 100) / 100;
  const insight = (c?.traits[INSIGHT_TRAIT] ?? NEUTRAL_TRAIT) / 100;
  const difficulty = (item.searchDifficulty ?? 50) / 100;
  const w = SEARCH_WEIGHTS;
  return sigmoid(
    w.energy * energy +
      w.insight * insight -
      w.difficulty * difficulty +
      w.clue * knownClues(state, actorId, item.id) -
      w.prior * priorSearches,
  );
}

export interface SearchInput {
  readonly actorId: Id;
  readonly locationId: Id;
  readonly rng: Rng;
  readonly witnesses?: readonly Listener[];
  readonly causedByEventId?: Id | null;
}

/** L'objet principal d'abord, puis les indices (par identifiant). Un indice trouvé révèle où est l'objet qu'il désigne. */
export function searchLocation(state: SimState, fc: FormatContext, input: SearchInput): SearchOutcome {
  requireCharacter(state, input.actorId);
  requireLocation(state, input.locationId);
  const fs = formatOf(state);
  const prior = fs.actionLog.filter(
    (r) => r.actorId === input.actorId && r.action === 'search' && r.locationId === input.locationId,
  ).length;
  const hidden = Object.values(fs.items)
    .filter((i) => i.locationId === input.locationId && i.hidden && i.holderId === null && i.state === 'active')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const isClue = (i: ItemNode): boolean => fs.itemDefs[i.itemDefId]?.kind === 'clue';
  const candidates = [...hidden.filter((i) => !isClue(i)), ...hidden.filter(isClue)];

  const out = emptyOutput();
  let probability = 0;
  let draw: number | null = null;
  let outcome: SearchOutcome['outcome'] = 'not_found';
  let foundId: Id | null = null;
  const items: ItemNode[] = [];

  for (const candidate of candidates) {
    probability = searchProbability(state, input.actorId, candidate, prior);
    draw = input.rng.next();
    if (draw >= probability) continue;
    const taken = findItem(state, fc, {
      actorId: input.actorId,
      itemId: candidate.id,
      ...(input.witnesses ? { witnesses: input.witnesses } : {}),
      causedByEventId: input.causedByEventId ?? null,
    });
    mergeOutput(out, taken);
    items.push(taken.item);
    outcome = isClue(candidate) ? 'found_clue' : 'found';
    foundId = candidate.id;
    if (outcome === 'found_clue') revealTargets(state, fc, out, input.actorId, candidate, taken.event.id);
    break;
  }
  recordAction(state, {
    actorId: input.actorId,
    action: 'search',
    targetId: null,
    locationId: input.locationId,
    epoch: fc.epoch,
    tick: fc.tick,
  });
  return { ...out, outcome, itemId: foundId, probability, draw, items };
}

/** Un indice désigne (`effects.points_to` = slug) l'emplacement des objets cachés de cette définition. */
export function revealTargets(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  actorId: Id,
  clue: ItemNode,
  eventId: Id,
): void {
  const fs = formatOf(state);
  const slug = fs.itemDefs[clue.itemDefId]?.effects['points_to'];
  if (typeof slug !== 'string') return;
  const targets = Object.values(fs.items)
    .filter((i) => {
      const def = fs.itemDefs[i.itemDefId];
      return def?.slug === slug && i.state === 'active' && i.holderId === null && i.locationId !== null && !i.isFake;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const target of targets) {
    const fact = ensureFact(state, fc, out, {
      subjectId: null,
      predicate: ITEM_AT,
      objectText: itemAtRef(target.id, target.locationId as Id),
      sensitivity: 2,
      originEventId: eventId,
    });
    witnessFact(state, fc, out, fact, [actorId], [], eventId);
  }
}
