import type { Id, SimState } from '../state/types.js';

export interface RoutePlan {
  readonly travelTicks: number;
  /** Lieux traversés, départ et arrivée compris. */
  readonly path: readonly Id[];
}

/**
 * Plus court chemin (en ticks) sur les routes dirigées de l'état — Dijkstra.
 * Les égalités se départagent par identifiant de lieu : le résultat est déterministe.
 */
export function shortestRoute(state: Pick<SimState, 'routes'>, from: Id, to: Id): RoutePlan | undefined {
  if (from === to) return { travelTicks: 0, path: [from] };

  const outgoing = new Map<Id, { to: Id; ticks: number }[]>();
  const nodes = new Set<Id>([from, to]);
  for (const r of state.routes) {
    nodes.add(r.fromLocationId);
    nodes.add(r.toLocationId);
    const list = outgoing.get(r.fromLocationId) ?? [];
    list.push({ to: r.toLocationId, ticks: r.travelTicks });
    outgoing.set(r.fromLocationId, list);
  }

  const dist = new Map<Id, number>([[from, 0]]);
  const previous = new Map<Id, Id>();
  const done = new Set<Id>();

  for (;;) {
    let current: Id | undefined;
    for (const n of [...nodes].sort()) {
      const d = dist.get(n);
      if (d === undefined || done.has(n)) continue;
      const best = current === undefined ? undefined : dist.get(current);
      if (best === undefined || d < best) current = n;
    }
    if (current === undefined || current === to) break;
    done.add(current);
    const base = dist.get(current) ?? 0;
    for (const { to: next, ticks } of outgoing.get(current) ?? []) {
      const candidate = base + ticks;
      const known = dist.get(next);
      const shorter = known === undefined || candidate < known;
      const tieWithSmallerPredecessor = candidate === known && current < (previous.get(next) ?? current);
      if (shorter || tieWithSmallerPredecessor) {
        dist.set(next, candidate);
        previous.set(next, current);
      }
    }
  }

  const total = dist.get(to);
  if (total === undefined) return undefined;
  const path: Id[] = [to];
  for (let at = previous.get(to); at !== undefined; at = previous.get(at)) path.unshift(at);
  return { travelTicks: total, path };
}
