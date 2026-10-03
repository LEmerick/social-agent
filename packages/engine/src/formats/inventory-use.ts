/** InventoryService, suite : montrer, utiliser, falsifier, périmer (game-formats.md §2.2-2.3). */
import { DomainError } from '../core/errors.js';
import { transmit } from '../knowledge/transmit.js';
import type { Listener } from '../scene/audience.js';
import { formatOf, type ItemNode } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import {
  INVENTORY_RULE,
  type ItemResult,
  hearing,
  locationOfCharacter,
  participants,
  payloadOf,
  requireActive,
  requireCharacter,
  requireDef,
  requireHeldBy,
  requireItem,
} from './inventory-core.js';
import { HOLDS, inventHolds, itemDefRef, learnHolds } from './item-knowledge.js';
import { emitEffect, emitEvent, emptyOutput, type FormatContext, type FormatOutput } from './output.js';

export interface ShowInput {
  readonly actorId: Id;
  readonly itemId: Id;
  /** Spectateurs : ceux qui entendent (`hears`) apprennent ce que l'objet montre. */
  readonly viewers: readonly Listener[];
  readonly causedByEventId?: Id | null;
}

/**
 * Montre un objet : les spectateurs constatent la possession (témoins). Un faux objet montré fait en plus
 * croire au vrai : le fait faux inventé leur est transmis par le porteur, avec la confiance qui lui est accordée.
 */
export function showItem(state: SimState, fc: FormatContext, input: ShowInput): ItemResult {
  requireCharacter(state, input.actorId);
  const item = requireItem(state, input.itemId);
  requireActive(item);
  requireHeldBy(item, input.actorId);
  const viewers = hearing(input.viewers).filter((v) => v.characterId !== input.actorId);
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type: 'item_shown',
    locationId: locationOfCharacter(state, input.actorId),
    payload: payloadOf(item, { by: input.actorId, viewers: viewers.map((v) => v.characterId) }),
    causedByEventId: input.causedByEventId ?? null,
    participants: participants(input.actorId, null, viewers),
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'item',
    characterId: input.actorId,
    dimension: 'holder',
    ruleId: INVENTORY_RULE,
    reason: item.id,
  });
  learnHolds(state, fc, out, { holderId: input.actorId, itemId: item.id, witnesses: viewers, eventId: event.id });
  if (item.isFake && viewers.length > 0) {
    const objectText = itemDefRef(requireDef(state, item.itemDefId).slug);
    const claim = Object.values(state.facts).find(
      (f) => f.inventedById === input.actorId && f.predicate === HOLDS && f.objectText === objectText,
    );
    if (claim) {
      out.knowledge.push(
        ...transmit(
          state,
          {
            factIds: [claim.id],
            fromId: input.actorId,
            listeners: viewers.map((v) => ({ ...v, role: 'addressee' as const })),
            viaEventId: event.id,
            epoch: fc.epoch,
            tick: fc.tick,
          },
          fc.ids,
        ).knowledge,
      );
    }
  }
  return { ...out, item };
}

export interface UseInput {
  readonly actorId: Id;
  readonly itemId: Id;
  readonly causedByEventId?: Id | null;
}

export interface UseResult extends ItemResult {
  /** Effets de la définition (vides pour un faux objet, qui ne fait rien). */
  readonly defEffects: Readonly<Record<string, unknown>>;
  readonly worked: boolean;
}

/** Joue un objet. Un faux objet est consommé sans effet ; `expires: 'after_use'` consomme un vrai objet. */
export function useItem(state: SimState, fc: FormatContext, input: UseInput): UseResult {
  requireCharacter(state, input.actorId);
  const item = requireItem(state, input.itemId);
  requireActive(item);
  requireHeldBy(item, input.actorId);
  const def = requireDef(state, item.itemDefId);
  const worked = !item.isFake;
  if (!worked || def.effects['expires'] === 'after_use') item.state = 'used';
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type: 'item_used',
    locationId: locationOfCharacter(state, input.actorId),
    importance: 0.5,
    payload: payloadOf(item, { by: input.actorId, worked, state: item.state }),
    causedByEventId: input.causedByEventId ?? null,
    participants: [{ characterId: input.actorId, role: 'actor' }],
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'item',
    characterId: input.actorId,
    dimension: 'state',
    ruleId: INVENTORY_RULE,
    reason: item.id,
  });
  return { ...out, item, defEffects: worked ? def.effects : {}, worked };
}

export interface FakeInput {
  /** Définition imitée. */
  readonly itemDefId: Id;
  readonly actorId: Id;
  readonly itemId?: Id;
  readonly causedByEventId?: Id | null;
}

/**
 * Fabrique un faux objet, porté par l'acteur : fait vrai `holds(acteur, item:<faux>)` et fait faux
 * `holds(acteur, item_def:<slug>)` inventé par lui (`invented_by`).
 */
export function fakeItem(state: SimState, fc: FormatContext, input: FakeInput): ItemResult {
  requireCharacter(state, input.actorId);
  const def = requireDef(state, input.itemDefId);
  const fs = formatOf(state);
  const id = input.itemId ?? fc.ids.next();
  if (fs.items[id]) throw new DomainError('DUPLICATE', `Objet ${id} déjà présent`);
  const item: ItemNode = {
    id,
    itemDefId: def.id,
    holderId: input.actorId,
    locationId: null,
    hidden: false,
    searchDifficulty: null,
    isFake: true,
    fakeOfItemDefId: def.id,
    state: 'active',
  };
  fs.items[id] = item;
  const out = emptyOutput();
  const event = emitEvent(state, fc, out, {
    type: 'item_faked',
    locationId: locationOfCharacter(state, input.actorId),
    importance: 0.5,
    payload: payloadOf(item, { by: input.actorId, fakeOfItemDefId: def.id }),
    causedByEventId: input.causedByEventId ?? null,
    participants: [{ characterId: input.actorId, role: 'actor' }],
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'item',
    characterId: input.actorId,
    dimension: 'holder',
    ruleId: INVENTORY_RULE,
    reason: id,
  });
  learnHolds(state, fc, out, { holderId: input.actorId, itemId: id, witnesses: [], eventId: event.id });
  inventHolds(state, fc, out, { inventorId: input.actorId, slug: def.slug, eventId: event.id });
  return { ...out, item };
}

/** Périme les objets actifs dont la définition expire avant l'époque courante (`item_expired`). */
export function expireItems(state: SimState, fc: FormatContext): FormatOutput & { readonly items: ItemNode[] } {
  const fs = formatOf(state);
  const out = emptyOutput();
  const items: ItemNode[] = [];
  for (const item of Object.values(fs.items).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const limit = fs.itemDefs[item.itemDefId]?.expiresAfterEpoch;
    if (item.state !== 'active' || limit === null || limit === undefined || fc.epoch <= limit) continue;
    item.state = 'expired';
    items.push(item);
    const event = emitEvent(state, fc, out, {
      type: 'item_expired',
      locationId: item.locationId,
      payload: payloadOf(item, { holderId: item.holderId, locationId: item.locationId }),
    });
    if (item.holderId) {
      emitEffect(fc, out, event.id, {
        targetKind: 'item',
        characterId: item.holderId,
        dimension: 'state',
        ruleId: INVENTORY_RULE,
        reason: item.id,
      });
    }
  }
  return { ...out, items };
}
