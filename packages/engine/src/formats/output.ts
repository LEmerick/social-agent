/**
 * Contexte et sortie communs des services de format. Les services sont purs : ils mutent le `SimState` (et son
 * `FormatState`) et renvoient ce qu'il faut journaliser ; ils ne touchent ni au stockage ni au LLM.
 * Un hook de tick verse la sortie dans le lot avec `appendOutput`.
 */
import type { IdFactory } from '../core/id.js';
import type { EffectRecord, EventParticipant, EventRecord } from '../state/journal.js';
import type { EffectTarget, FactNode, Goal, Id, KnowledgeEdge, SimState } from '../state/types.js';
import type { MutableTickBatch } from '../epoch/types.js';

export interface FormatContext {
  readonly ids: IdFactory;
  readonly epochId: Id;
  readonly epoch: number;
  readonly tick: number;
}

export interface StatusChange {
  readonly characterId: Id;
  readonly to: 'eliminated';
}

export interface FormatOutput {
  readonly events: EventRecord[];
  readonly effects: EffectRecord[];
  readonly facts: FactNode[];
  readonly knowledge: KnowledgeEdge[];
  /** Objectifs de saison créés par les missions (à persister par l'appelant). */
  readonly goals: { readonly characterId: Id; readonly goal: Goal }[];
  /** Changements de statut à répercuter en base (`characters.updateStatus`). */
  readonly statusChanges: StatusChange[];
}

export const emptyOutput = (): FormatOutput => ({
  events: [],
  effects: [],
  facts: [],
  knowledge: [],
  goals: [],
  statusChanges: [],
});

export function mergeOutput(into: FormatOutput, from: FormatOutput): void {
  into.events.push(...from.events);
  into.effects.push(...from.effects);
  into.facts.push(...from.facts);
  into.knowledge.push(...from.knowledge);
  into.goals.push(...from.goals);
  into.statusChanges.push(...from.statusChanges);
}

/** Verse la sortie dans le lot du tick (événements, effets, faits, connaissances). */
export function appendOutput(batch: MutableTickBatch, out: FormatOutput): void {
  batch.events.push(...out.events);
  batch.effects.push(...out.effects);
  batch.facts.push(...out.facts);
  batch.knowledge.push(...out.knowledge);
}

export interface EventSpec {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly importance?: number;
  readonly locationId?: Id | null;
  readonly sceneId?: Id | null;
  readonly causedByEventId?: Id | null;
  readonly participants?: readonly EventParticipant[];
}

/** Crée l'événement, lui attribue le prochain `seq` du monde et l'ajoute à la sortie. */
export function emitEvent(state: SimState, fc: FormatContext, out: FormatOutput, spec: EventSpec): EventRecord {
  const event: EventRecord = {
    id: fc.ids.next(),
    epochId: fc.epochId,
    tick: fc.tick,
    seq: state.nextEventSeq,
    type: spec.type,
    sceneId: spec.sceneId ?? null,
    interactionId: null,
    locationId: spec.locationId ?? null,
    payload: spec.payload,
    importance: spec.importance ?? 0.3,
    causedByEventId: spec.causedByEventId ?? null,
    participants: spec.participants ?? [],
  };
  state.nextEventSeq += 1;
  out.events.push(event);
  return event;
}

export interface EffectSpec {
  readonly targetKind: EffectTarget;
  readonly characterId: Id;
  readonly otherCharacterId?: Id | null;
  readonly dimension: string;
  readonly delta?: number;
  readonly ruleId: string;
  readonly reason?: string | null;
  readonly valueAfter?: number | null;
}

export const FORMAT_RULE_VERSION = 1;

/** Ajoute un effet journalisé (sans l'appliquer : `applyEffect` s'en charge pour les valeurs numériques). */
export function emitEffect(fc: FormatContext, out: FormatOutput, eventId: Id, spec: EffectSpec): EffectRecord {
  const effect: EffectRecord = {
    id: fc.ids.next(),
    eventId,
    epochId: fc.epochId,
    tick: fc.tick,
    targetKind: spec.targetKind,
    characterId: spec.characterId,
    otherCharacterId: spec.otherCharacterId ?? null,
    dimension: spec.dimension,
    delta: spec.delta ?? 0,
    ruleId: spec.ruleId,
    ruleVersion: FORMAT_RULE_VERSION,
    reason: spec.reason ?? null,
    valueAfter: spec.valueAfter ?? null,
  };
  out.effects.push(effect);
  return effect;
}
