/** Suivi lu par le DSL : historique des actions (`action_done`) et ticks passés ensemble (`present_with`). */
import type { Id, SimState } from '../state/types.js';
import { formatOf, pairKey, type ActionRecordNode } from '../state/format-state.js';

export function recordAction(state: SimState, record: ActionRecordNode): void {
  formatOf(state).actionLog.push(record);
}

/** À appeler une fois par tick avec les membres de chaque scène ouverte : +1 tick pour chaque paire présente. */
export function trackPresence(state: SimState, scenes: readonly (readonly Id[])[]): void {
  const presence = formatOf(state).presence;
  for (const members of scenes) {
    const sorted = [...new Set(members)].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = pairKey(sorted[i] as Id, sorted[j] as Id);
        presence[key] = (presence[key] ?? 0) + 1;
      }
    }
  }
}
