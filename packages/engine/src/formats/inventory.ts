/**
 * InventoryService pur (game-formats.md §2) : placement, découverte, ramassage, dons, trocs, vols, cache.
 * Toute possession est unique (porteur OU lieu) et projetée des events `item_*` ; chaque changement crée un
 * événement, un effet `item` et un fait `holds` (la possession est une connaissance).
 * Chaque opération valide avant de muter : une erreur (`DomainError`) laisse l'état intact.
 * Montrer, utiliser, falsifier et périmer : voir `inventory-use.ts`.
 */
import { DomainError } from '../core/errors.js';
import type { Listener } from '../scene/audience.js';
import type { EventRecord } from '../state/journal.js';
import { formatOf, type ItemNode } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import {
  DEFAULT_HIDE_DIFFICULTY,
  INVENTORY_RULE,
  type ItemResult,
  hearing,
  locationOfCharacter,
  participants,
  payloadOf,
  requireActive,
  requireCharacter,
  requireDef,
  requireDifficulty,
  requireHeldBy,
  requireItem,
  requireLocation,
  requireTransferable,
} from './inventory-core.js';
import { ITEM_AT, ensureFact, itemAtRef, learnHolds, witnessFact } from './item-knowledge.js';
import { emitEffect, emitEvent, emptyOutput, type FormatContext, type FormatOutput } from './output.js';

export type ItemEventResult = ItemResult & { readonly event: EventRecord };

export interface PlaceInput {
  readonly itemDefId: Id;
  readonly locationId: Id;
  readonly hidden: boolean;
  readonly difficulty?: number;
  /** Identifiant imposé (sinon tiré de la fabrique). */
  readonly itemId?: Id;
  readonly causedByEventId?: Id | null;
}

/** Dépose un exemplaire neuf sur un lieu (événement `item_placed`, sans effet : aucun personnage n'agit). */
export function placeItem(state: SimState, fc: FormatContext, input: PlaceInput): ItemResult {
  const def = requireDef(state, input.itemDefId);
  requireLocation(state, input.locationId);
  const difficulty = input.hidden ? (input.difficulty ?? DEFAULT_HIDE_DIFFICULTY) : (input.difficulty ?? null);
  requireDifficulty(difficulty);
  const fs = formatOf(state);
  const id = input.itemId ?? fc.ids.next();
  if (fs.items[id]) throw new DomainError('DUPLICATE', `Objet ${id} déjà présent`);
  const item: ItemNode = {
    id,
    itemDefId: def.id,
    holderId: null,
    locationId: input.locationId,
    hidden: input.hidden,
    searchDifficulty: difficulty,
    isFake: false,
    fakeOfItemDefId: null,
    state: 'active',
  };
  fs.items[id] = item;
  const out = emptyOutput();
  emitEvent(state, fc, out, {
    type: 'item_placed',
    locationId: input.locationId,
    payload: payloadOf(item, { locationId: input.locationId, hidden: input.hidden, difficulty }),
    causedByEventId: input.causedByEventId ?? null,
  });
  return { ...out, item };
}

export interface TakeInput {
  readonly actorId: Id;
  readonly itemId: Id;
  readonly witnesses?: readonly Listener[];
  readonly causedByEventId?: Id | null;
}

function takeFromLocation(
  state: SimState,
  fc: FormatContext,
  input: TakeInput,
  type: 'item_found' | 'item_picked_up',
): ItemEventResult {
  requireCharacter(state, input.actorId);
  const item = requireItem(state, input.itemId);
  requireActive(item);
  if (item.holderId !== null || item.locationId === null) {
    throw new DomainError('ITEM_NOT_AVAILABLE', `L'objet ${item.id} n'est pas posé sur un lieu`);
  }
  if (type === 'item_picked_up' && item.hidden) {
    throw new DomainError('ITEM_HIDDEN', `L'objet ${item.id} est caché : il faut le trouver`);
  }
  const witnesses = hearing(input.witnesses ?? []);
  const fromLocationId = item.locationId;
  item.holderId = input.actorId;
  item.locationId = null;
  item.hidden = false;
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type,
    locationId: fromLocationId,
    importance: type === 'item_found' ? 0.5 : 0.3,
    payload: payloadOf(item, {
      to: input.actorId,
      from: null,
      fromLocationId,
      how: type === 'item_found' ? 'found' : 'picked_up',
    }),
    causedByEventId: input.causedByEventId ?? null,
    participants: participants(input.actorId, null, witnesses),
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'item',
    characterId: input.actorId,
    dimension: 'holder',
    ruleId: INVENTORY_RULE,
    reason: item.id,
  });
  learnHolds(state, fc, out, { holderId: input.actorId, itemId: item.id, witnesses, eventId: event.id });
  return { ...out, item, event };
}

/** `item_found` : un objet caché est découvert par `actorId` (le tirage est dans `searchLocation`). */
export const findItem = (state: SimState, fc: FormatContext, input: TakeInput): ItemEventResult =>
  takeFromLocation(state, fc, input, 'item_found');

/** `item_picked_up` : ramasse un objet visible sur le lieu de l'acteur. */
export function pickUp(state: SimState, fc: FormatContext, input: TakeInput): ItemEventResult {
  const here = locationOfCharacter(state, input.actorId);
  const item = requireItem(state, input.itemId);
  if (here === null || item.locationId !== here) {
    throw new DomainError('NOT_HERE', `L'objet ${item.id} n'est pas sur le lieu de ${input.actorId}`);
  }
  return takeFromLocation(state, fc, input, 'item_picked_up');
}

export interface HandOverInput {
  readonly fromId: Id;
  readonly toId: Id;
  readonly itemId: Id;
  readonly witnesses?: readonly Listener[];
  readonly causedByEventId?: Id | null;
}

type Transfer = 'item_given' | 'item_traded' | 'item_stolen';

function moveBetweenHolders(
  state: SimState,
  fc: FormatContext,
  input: HandOverInput & { type: Transfer; detected?: boolean },
): ItemEventResult {
  requireCharacter(state, input.fromId);
  requireCharacter(state, input.toId);
  if (input.fromId === input.toId) throw new DomainError('INVALID_TRANSFER', 'Source et destinataire identiques');
  const item = requireItem(state, input.itemId);
  requireActive(item);
  requireHeldBy(item, input.fromId);
  requireTransferable(state, item);
  const stolen = input.type === 'item_stolen';
  const detected = !stolen || input.detected === true;
  // Un vol non détecté ne laisse aucune trace chez la victime ni chez les témoins.
  const witnesses = detected ? hearing(input.witnesses ?? []) : [];
  item.holderId = input.toId;
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type: input.type,
    locationId: locationOfCharacter(state, input.toId),
    importance: stolen ? 0.7 : 0.4,
    payload: payloadOf(item, {
      from: input.fromId,
      to: input.toId,
      how: input.type.slice('item_'.length),
      ...(stolen ? { detected } : {}),
    }),
    causedByEventId: input.causedByEventId ?? null,
    participants: participants(input.toId, detected ? input.fromId : null, witnesses),
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'item',
    characterId: input.toId,
    otherCharacterId: input.fromId,
    dimension: 'holder',
    ruleId: INVENTORY_RULE,
    reason: item.id,
  });
  // Un vol repéré : la victime sait qui détient désormais l'objet, comme les témoins qui entendent.
  const aware: Listener[] = detected ? [...witnesses, { characterId: input.fromId, perception: 'hears' }] : witnesses;
  learnHolds(state, fc, out, { holderId: input.toId, itemId: item.id, witnesses: aware, eventId: event.id });
  return { ...out, item, event };
}

export interface GiveInput extends HandOverInput {
  /** Marque le transfert comme un troc (`item_traded`) plutôt qu'un don (`item_given`). */
  readonly traded?: boolean;
}

export const giveItem = (state: SimState, fc: FormatContext, input: GiveInput): ItemEventResult =>
  moveBetweenHolders(state, fc, { ...input, type: input.traded ? 'item_traded' : 'item_given' });

export interface TradeInput {
  readonly aId: Id;
  readonly bId: Id;
  /** Objet que `aId` cède à `bId`. */
  readonly aItemId: Id;
  /** Objet que `bId` cède à `aId`. */
  readonly bItemId: Id;
  readonly witnesses?: readonly Listener[];
  readonly causedByEventId?: Id | null;
}

/** Troc : deux `item_traded`, atomique (les deux objets sont validés avant le premier transfert). */
export function tradeItems(
  state: SimState,
  fc: FormatContext,
  input: TradeInput,
): FormatOutput & { readonly items: ItemNode[] } {
  const a = requireItem(state, input.aItemId);
  const b = requireItem(state, input.bItemId);
  for (const [item, holder] of [
    [a, input.aId],
    [b, input.bId],
  ] as const) {
    requireActive(item);
    requireHeldBy(item, holder);
    requireTransferable(state, item);
  }
  const witnesses = input.witnesses ? { witnesses: input.witnesses } : {};
  const first = moveBetweenHolders(state, fc, {
    fromId: input.aId,
    toId: input.bId,
    itemId: a.id,
    ...witnesses,
    causedByEventId: input.causedByEventId ?? null,
    type: 'item_traded',
  });
  const second = moveBetweenHolders(state, fc, {
    fromId: input.bId,
    toId: input.aId,
    itemId: b.id,
    ...witnesses,
    causedByEventId: first.event.id,
    type: 'item_traded',
  });
  const out = emptyOutput();
  for (const part of [first, second]) {
    out.events.push(...part.events);
    out.effects.push(...part.effects);
    out.facts.push(...part.facts);
    out.knowledge.push(...part.knowledge);
  }
  return { ...out, items: [first.item, second.item] };
}

export interface StealInput extends HandOverInput {
  /** Le vol est repéré : la victime et les témoins qui entendent l'apprennent. */
  readonly detected: boolean;
}

export const stealItem = (state: SimState, fc: FormatContext, input: StealInput): ItemEventResult =>
  moveBetweenHolders(state, fc, { ...input, type: 'item_stolen', detected: input.detected });

export interface HideInput {
  readonly actorId: Id;
  readonly itemId: Id;
  /** Lieu de la cache ; par défaut le lieu de l'acteur. */
  readonly locationId?: Id;
  readonly difficulty?: number;
  readonly causedByEventId?: Id | null;
}

/** Cache un objet porté sur un lieu : il quitte l'inventaire et devient trouvable par fouille. Le cacheur sait où. */
export function hideItem(state: SimState, fc: FormatContext, input: HideInput): ItemResult {
  requireCharacter(state, input.actorId);
  const item = requireItem(state, input.itemId);
  requireActive(item);
  requireHeldBy(item, input.actorId);
  const locationId = input.locationId ?? locationOfCharacter(state, input.actorId);
  if (!locationId) throw new DomainError('NOT_HERE', `${input.actorId} n'est sur aucun lieu`);
  requireLocation(state, locationId);
  const difficulty = input.difficulty ?? DEFAULT_HIDE_DIFFICULTY;
  requireDifficulty(difficulty);
  item.holderId = null;
  item.locationId = locationId;
  item.hidden = true;
  item.searchDifficulty = difficulty;
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type: 'item_hidden',
    locationId,
    payload: payloadOf(item, { by: input.actorId, locationId, difficulty }),
    causedByEventId: input.causedByEventId ?? null,
    participants: [{ characterId: input.actorId, role: 'actor' }],
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'item',
    characterId: input.actorId,
    dimension: 'location',
    ruleId: INVENTORY_RULE,
    reason: item.id,
  });
  const fact = ensureFact(state, fc, out, {
    subjectId: null,
    predicate: ITEM_AT,
    objectText: itemAtRef(item.id, locationId),
    sensitivity: 2,
    originEventId: event.id,
  });
  witnessFact(state, fc, out, fact, [input.actorId], [], event.id);
  return { ...out, item };
}
