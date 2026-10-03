/**
 * Sélection des moments : déterministe (aucun hasard, tris totaux). D'abord le quota de temps d'écran des personnages
 * joueurs (leurs moments les plus importants), puis remplissage par importance jusqu'à la durée visée.
 */
import type { EventRecord, Id, InteractionRecord, UtteranceRecord } from '@ai-reality/engine';
import type { EpochDigest, Moment, SelectOptions } from './types.js';

const BASE_SECONDS = 6;
const IMPORTANCE_SECONDS = 10;
const SECONDS_PER_UTTERANCE = 3;
const MAX_SECONDS = 45;
const DEFAULT_MIN_IMPORTANCE = 0.3;

/** Remonte la chaîne `caused_by_event_id` (au plus proche d'abord), en s'arrêtant sur un cycle. */
export function ancestorsOf(eventId: Id, causes: Readonly<Record<Id, Id | null>>): Id[] {
  const chain: Id[] = [];
  const seen = new Set<Id>([eventId]);
  for (let cur = causes[eventId] ?? null; cur !== null && !seen.has(cur); cur = causes[cur] ?? null) {
    chain.push(cur);
    seen.add(cur);
  }
  return chain;
}

const sortKey = (a: Moment, b: Moment): number => b.importance - a.importance || a.seq - b.seq;

export function candidatesOf(digest: EpochDigest): Moment[] {
  const names = new Map(digest.characters.map((c) => [c.id, c.firstName]));
  const utterancesOf = new Map<Id, UtteranceRecord[]>();
  for (const u of digest.utterances)
    utterancesOf.set(u.interactionId, [...(utterancesOf.get(u.interactionId) ?? []), u]);
  const interactions = new Map<Id, InteractionRecord>(digest.interactions.map((i) => [i.id, i]));
  const arcOfEvent = new Map<Id, Id>();
  for (const arc of [...digest.openArcs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const id of arc.eventIds) if (!arcOfEvent.has(id)) arcOfEvent.set(id, arc.id);
  }

  return digest.events.map((e: EventRecord): Moment => {
    const utterances = (e.interactionId !== null ? utterancesOf.get(e.interactionId) : undefined) ?? [];
    const ancestors = ancestorsOf(e.id, digest.causes);
    const ids = [...new Set(e.participants.map((p) => p.characterId))].sort();
    const who = ids.map((id) => names.get(id) ?? id).join(', ');
    const interaction = e.interactionId !== null ? interactions.get(e.interactionId) : undefined;
    return {
      eventId: e.id,
      epochId: e.epochId,
      tick: e.tick,
      seq: e.seq,
      type: e.type,
      importance: e.importance,
      sceneId: e.sceneId,
      locationId: e.locationId,
      participantIds: ids,
      causedByEventId: e.causedByEventId,
      ancestors,
      continuesArcId: [e.id, ...ancestors].map((id) => arcOfEvent.get(id)).find((id) => id !== undefined) ?? null,
      seconds: Math.min(
        MAX_SECONDS,
        BASE_SECONDS + Math.round(e.importance * IMPORTANCE_SECONDS) + SECONDS_PER_UTTERANCE * utterances.length,
      ),
      summary: `${interaction?.action ?? e.type}${who ? ` (${who})` : ''}`,
      utteranceIds: utterances.map((u) => u.id),
    };
  });
}

export function selectMoments(digest: EpochDigest, opts: SelectOptions): Moment[] {
  const minImportance = opts.minImportance ?? DEFAULT_MIN_IMPORTANCE;
  const players = [...new Set(opts.playerCharacterIds ?? digest.playerCharacterIds)].sort();
  const all = candidatesOf(digest).sort(sortKey);

  const chosen = new Map<Id, Moment>();
  let total = 0;
  const screen = new Map<Id, number>();
  const take = (m: Moment): void => {
    chosen.set(m.eventId, m);
    total += m.seconds;
    for (const id of m.participantIds) screen.set(id, (screen.get(id) ?? 0) + m.seconds);
  };

  // 1. Quota : chaque joueur (ordre d'id), ses moments les plus importants jusqu'à son minimum, dans la limite de la durée visée.
  for (const player of players) {
    for (const m of all) {
      if ((screen.get(player) ?? 0) >= opts.minScreenTimePerPlayer) break;
      if (chosen.has(m.eventId) || !m.participantIds.includes(player)) continue;
      if (total + m.seconds > opts.targetSeconds) continue;
      take(m);
    }
  }

  // 2. Remplissage par importance : un moment qui ne tient plus est sauté, un plus court peut encore passer.
  for (const m of all) {
    if (chosen.has(m.eventId) || m.importance < minImportance) continue;
    if (total + m.seconds > opts.targetSeconds) continue;
    take(m);
  }

  return [...chosen.values()].sort((a, b) => a.seq - b.seq);
}
