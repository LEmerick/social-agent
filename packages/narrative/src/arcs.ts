/** Regroupement des moments en arcs : une chaîne `caused_by_event_id` = un arc ; un arc ouvert se prolonge. */
import { deriveUuid } from '@ai-reality/engine';
import type { Id } from '@ai-reality/engine';
import type { Moment, NarrativeArc } from './types.js';

export const arcIdOf = (rootEventId: Id): Id => deriveUuid(`arc:${rootEventId}`);

/**
 * Le parent d'un moment est son ancêtre causal le plus proche parmi les moments retenus (une cause écartée de la
 * sélection ne casse pas la chaîne). Les moments sans parent retenu ouvrent un arc, sauf s'ils prolongent un arc
 * ouvert (`continuesArcId`). Résultat trié par importance décroissante puis par racine.
 */
export function buildArcsFrom(
  worldId: Id,
  moments: readonly Moment[],
  openArcs: readonly NarrativeArc[] = [],
): NarrativeArc[] {
  const previous = new Map<Id, NarrativeArc>(openArcs.map((a) => [a.id, a]));
  const byEvent = new Map<Id, Moment>(moments.map((m) => [m.eventId, m]));
  const groupOf = new Map<Id, string>();
  const rootOf = (m: Moment): string => {
    const cached = groupOf.get(m.eventId);
    if (cached !== undefined) return cached;
    const parent = m.ancestors.map((id) => byEvent.get(id)).find((p): p is Moment => p !== undefined);
    const key = m.continuesArcId ?? (parent ? rootOf(parent) : `root:${m.eventId}`);
    groupOf.set(m.eventId, key);
    return key;
  };

  const groups = new Map<string, Moment[]>();
  for (const m of [...moments].sort((a, b) => a.seq - b.seq)) {
    const key = rootOf(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const arcs: NarrativeArc[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    const arcId = key.startsWith('root:') ? arcIdOf(first.eventId) : key;
    const old = previous.get(arcId);
    const characters = new Set<Id>(old?.characterIds);
    for (const m of group) for (const id of m.participantIds) characters.add(id);
    arcs.push({
      id: arcId,
      worldId,
      title: old?.title ?? first.summary,
      status: 'open',
      rootEventId: old?.rootEventId ?? first.eventId,
      firstEpochId: old?.firstEpochId ?? first.epochId,
      lastEpochId: last.epochId,
      characterIds: [...characters].sort(),
      eventIds: [...new Set([...(old?.eventIds ?? []), ...group.map((m) => m.eventId)])],
      importance: Math.max(old?.importance ?? 0, ...group.map((m) => m.importance)),
    });
  }
  return arcs.sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : 1));
}
