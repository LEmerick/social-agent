import type { Id, SimState } from '../state/types.js';
import type { AgentSituation, PreviousTurn } from './context.js';

/** Situation d'un personnage d'après les positions du `SimState` : lieu, et tous ceux qui s'y trouvent. */
export function situationOf(
  state: Readonly<SimState>,
  characterId: Id,
  previousTurns: readonly PreviousTurn[] = [],
): AgentSituation {
  const own = state.positions[characterId];
  const locationId = own?.kind === 'at' ? own.locationId : null;
  const sceneMemberIds =
    locationId === null
      ? []
      : Object.keys(state.positions)
          .sort()
          .filter((id) => {
            const p = state.positions[id];
            return id !== characterId && p?.kind === 'at' && p.locationId === locationId;
          });
  return { locationId, sceneMemberIds, previousTurns };
}
