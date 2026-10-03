import type { Id, LocationNode, SimState, Volume } from '../state/types.js';

export interface Listener {
  readonly characterId: Id;
  readonly perception: 'hears' | 'sees';
}

/**
 * Qui perçoit une prise de parole (engine-architecture.md §5, §7).
 *
 * - même zone, ou lieu sans zones : le personnage entend ;
 * - autre zone du même lieu : `whisper` ⇒ voit seulement ; `loud` ⇒ entend ;
 *   `normal` ⇒ voit seulement, sauf si la zone du locuteur porte `hearingRange = 'location'` ;
 * - personne hors du lieu du locuteur n'est dans l'audience (en transit, hors-jeu, ailleurs) ;
 * - le locuteur lui-même n'en fait pas partie.
 *
 * `sceneMembers` donne l'ordre de sortie ; les lieux et zones sont lus dans `state.positions`.
 */
export function audience(
  state: Readonly<SimState>,
  sceneMembers: readonly Id[],
  speakerId: Id,
  volume: Volume,
): Listener[] {
  const speaker = state.positions[speakerId];
  if (speaker?.kind !== 'at') return [];
  const location = state.locations[speaker.locationId];
  const speakerZone = location?.zones.find((z) => z.id === speaker.zoneId);

  const listeners: Listener[] = [];
  for (const characterId of sceneMembers) {
    if (characterId === speakerId) continue;
    const position = state.positions[characterId];
    if (position?.kind !== 'at' || position.locationId !== speaker.locationId) continue;

    const sameArea = !hasZones(location) || position.zoneId === speaker.zoneId;
    const hears = sameArea || volume === 'loud' || (volume === 'normal' && speakerZone?.hearingRange === 'location');
    listeners.push({ characterId, perception: hears ? 'hears' : 'sees' });
  }
  return listeners;
}

function hasZones(location: LocationNode | undefined): boolean {
  return (location?.zones.length ?? 0) > 0;
}
