/** Application d'un effet à l'état et journalisation, et création d'events : briques communes à la résolution et à l'économie. */
import type { IdFactory } from '../core/id.js';
import { DomainError } from '../core/errors.js';
import { applyEffect } from '../state/apply-effect.js';
import type { EffectInput, EffectRecord, EventParticipant, EventRecord } from '../state/journal.js';
import type { Id, SimState } from '../state/types.js';

/** Event auquel se rattachent les effets produits. */
export interface EventLink {
  readonly eventId: Id;
  readonly epochId: Id;
  readonly tick: number;
}

/** Applique l'effet (mutation de `state` via `applyEffect`) et renvoie son enregistrement avec `valueAfter`. */
export function applyAndRecord(state: SimState, fx: EffectInput, link: EventLink, ids: IdFactory): EffectRecord {
  const valueAfter = applyEffect(state, fx);
  return { ...fx, id: ids.next(), eventId: link.eventId, epochId: link.epochId, tick: link.tick, valueAfter };
}

export interface EventInit {
  readonly type: string;
  readonly importance: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly participants: readonly EventParticipant[];
  readonly sceneId?: Id | null;
  readonly interactionId?: Id | null;
  readonly locationId?: Id | null;
  readonly causedByEventId?: Id | null;
}

/** Crée un event au tick courant et consomme le prochain numéro de séquence (`state.nextEventSeq`). */
export function openEvent(state: SimState, ids: IdFactory, epochId: Id | null, init: EventInit): EventRecord {
  const epoch = epochId ?? state.epoch?.id ?? null;
  if (epoch === null) throw new DomainError('NO_EPOCH', 'Aucune époque courante dans le SimState');
  return {
    id: ids.next(),
    epochId: epoch,
    tick: state.tick,
    seq: state.nextEventSeq++,
    type: init.type,
    sceneId: init.sceneId ?? null,
    interactionId: init.interactionId ?? null,
    locationId: init.locationId ?? null,
    payload: init.payload,
    importance: init.importance,
    causedByEventId: init.causedByEventId ?? null,
    participants: init.participants,
  };
}
