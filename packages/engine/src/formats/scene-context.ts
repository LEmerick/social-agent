/**
 * Pont avec le catalogue d'actions : complète le `SceneContext` d'une scène avec ce que savent les formats
 * (objets au sol, inventaires, votes ouverts, camps ennemis). Pur : lit le `FormatState`, ne le modifie pas.
 */
import type { SceneContext } from '../rules/types.js';
import { itemsAt, peekFormat, teamOf } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import { candidatesOf } from './votes.js';

export function withFormatContext(state: Readonly<SimState>, base: SceneContext, actorId: Id): SceneContext {
  const fs = peekFormat(state);
  const epoch = state.epoch?.number ?? 0;
  const actorLocation = base.members.find((m) => m.characterId === actorId)?.locationId ?? null;

  const inventory: Record<Id, Id[]> = {};
  for (const m of base.members) {
    inventory[m.characterId] = Object.values(fs.items)
      .filter((i) => i.holderId === m.characterId && i.state === 'active')
      .map((i) => i.id)
      .sort();
  }
  const itemsHere = actorLocation
    ? itemsAt(fs, actorLocation)
        .filter((i) => !i.hidden && i.state === 'active')
        .map((i) => i.id)
    : [];
  const untransferable = Object.values(fs.items)
    .filter((i) => fs.itemDefs[i.itemDefId]?.transferable === false)
    .map((i) => i.id)
    .sort();

  const open = Object.values(fs.voteSessions)
    .filter(
      (s) =>
        s.result === null &&
        s.kind !== 'public' &&
        s.electorate.includes(actorId) &&
        !fs.votes.some((v) => v.voteSessionId === s.id && v.voterId === actorId),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const voteUpcoming = Object.values(fs.scheduled).some(
    (s) => s.kind === 'council' && s.firedEventId === null && (s.epoch === null || s.epoch === epoch),
  );

  const myTeam = teamOf(fs, actorId, epoch);
  const enemyCamps = Object.values(fs.teams)
    .filter((t) => t.dissolvedEpoch === null && t.id !== myTeam && t.campLocationId !== null)
    .map((t) => t.campLocationId as Id)
    .sort();

  return {
    ...base,
    voteUpcoming: voteUpcoming || open !== undefined,
    voteOpen: open !== undefined,
    ...(open ? { voteCandidates: candidatesOf(state, open) } : {}),
    itemsHere,
    inventory,
    untransferable,
    enemyCamps,
  };
}
