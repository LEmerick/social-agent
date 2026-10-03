/** Aides communes aux opérations d'inventaire : gardes d'invariants et construction des événements. */
import { DomainError } from '../core/errors.js';
import type { Listener } from '../scene/audience.js';
import type { EventParticipant } from '../state/journal.js';
import { formatOf, type ItemDefNode, type ItemNode } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import type { FormatOutput } from './output.js';

export interface ItemResult extends FormatOutput {
  readonly item: ItemNode;
}

export const INVENTORY_RULE = 'inventory';
export const DEFAULT_HIDE_DIFFICULTY = 50;

export function requireItem(state: SimState, itemId: Id): ItemNode {
  const item = formatOf(state).items[itemId];
  if (!item) throw new DomainError('NOT_FOUND', `Objet ${itemId} inconnu`);
  return item;
}

export function requireDef(state: SimState, defId: Id): ItemDefNode {
  const def = formatOf(state).itemDefs[defId];
  if (!def) throw new DomainError('NOT_FOUND', `Définition d'objet ${defId} inconnue`);
  return def;
}

export function requireCharacter(state: SimState, id: Id): void {
  if (!state.characters[id]) throw new DomainError('NOT_FOUND', `Personnage ${id} absent du SimState`);
}

export function requireLocation(state: SimState, id: Id): void {
  if (!state.locations[id]) throw new DomainError('NOT_FOUND', `Lieu ${id} absent du SimState`);
}

export function requireHeldBy(item: ItemNode, holderId: Id): void {
  if (item.holderId !== holderId) {
    throw new DomainError('ITEM_NOT_HELD', `${holderId} ne possède pas l'objet ${item.id}`);
  }
}

export function requireActive(item: ItemNode): void {
  if (item.state !== 'active') throw new DomainError('ITEM_INACTIVE', `L'objet ${item.id} est ${item.state}`);
}

export function requireTransferable(state: SimState, item: ItemNode): void {
  if (!requireDef(state, item.itemDefId).transferable) {
    throw new DomainError('ITEM_UNTRANSFERABLE', `L'objet ${item.id} n'est pas transférable`);
  }
}

export function requireDifficulty(difficulty: number | null): void {
  if (difficulty !== null && (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 100)) {
    throw new DomainError('INVALID_ITEM', `Difficulté ${String(difficulty)} hors 0..100`);
  }
}

/** Lieu courant d'un personnage (`null` s'il est en transit ou hors-jeu). */
export function locationOfCharacter(state: Readonly<SimState>, characterId: Id): Id | null {
  const position = state.positions[characterId];
  return position?.kind === 'at' ? position.locationId : null;
}

export const hearing = (witnesses: readonly Listener[]): Listener[] =>
  witnesses.filter((w) => w.perception === 'hears');

export function participants(actorId: Id, targetId: Id | null, witnesses: readonly Listener[]): EventParticipant[] {
  const seen = new Set<Id>([actorId]);
  const list: EventParticipant[] = [{ characterId: actorId, role: 'actor' }];
  if (targetId && !seen.has(targetId)) {
    seen.add(targetId);
    list.push({ characterId: targetId, role: 'target' });
  }
  for (const w of witnesses) {
    if (seen.has(w.characterId)) continue;
    seen.add(w.characterId);
    list.push({ characterId: w.characterId, role: 'witness' });
  }
  return list;
}

export const payloadOf = (item: ItemNode, extra: Record<string, unknown>): Record<string, unknown> => ({
  itemId: item.id,
  itemDefId: item.itemDefId,
  ...extra,
});
