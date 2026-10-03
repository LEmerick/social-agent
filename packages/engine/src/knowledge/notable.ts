/**
 * Faits créés par les interactions (règle `notable_fact@1`, phase 3.f).
 *
 * Une interaction notable laisse un fait vrai « acteur prédicat cible » ; `spread_rumor` et `lie` créent un fait faux.
 * Sensibilité (0 public … 3 secret) = base de l'action, décalée selon le volume : chuchoté 0, caché +1, normal −1, fort −2
 * (bornée à 0..3). Une proposition d'alliance chuchotée vaut 2 : assez pour déclencher une intention `tell`.
 */
import type { ActionVolume } from '../rules/types.js';
import { relOf } from '../rules/preconditions.js';
import type { Id, SimState } from '../state/types.js';
import type { FactInput } from './facts.js';

export const NOTABLE_RULE = { id: 'notable_fact', version: 1 } as const;

export interface NotableFact {
  readonly predicate: string;
  readonly sensitivity: number;
}

const BASE: Readonly<Record<string, readonly [predicate: string, base: number]>> = {
  confide: ['s’est confié à', 1],
  express_feelings: ['a déclaré ses sentiments à', 2],
  flirt: ['a flirté avec', 2],
  provoke: ['a provoqué', 2],
  insult: ['a insulté', 2],
  propose_alliance: ['a proposé une alliance à', 2],
  break_alliance: ['a rompu son alliance avec', 3],
  threaten: ['a menacé', 2],
  confront: ['a confronté', 2],
  accuse: ['a accusé', 2],
  sabotage: ['a saboté', 2],
  steal: ['a volé', 2],
};

const VOLUME_SHIFT: Readonly<Record<ActionVolume, number>> = { hidden: 1, whisper: 0, normal: -1, loud: -2 };

const clampSensitivity = (n: number): number => Math.min(3, Math.max(0, n));

export const sensitivityFor = (base: number, volume: ActionVolume): number =>
  clampSensitivity(base + VOLUME_SHIFT[volume]);

/** Fait que laisse cette action, ou `null` pour les actions sans trace (bavardage, compliment, déplacement…). */
export function notableFact(action: string, volume: ActionVolume): NotableFact | null {
  const spec = BASE[action];
  return spec ? { predicate: spec[0], sensitivity: sensitivityFor(spec[1], volume) } : null;
}

/**
 * Contenu d'une rumeur ou d'un mensonge (faits faux), déterministe :
 * - `spread_rumor` : « S aurait trahi la cible », S = le personnage (hors acteur et cible) que l'acteur déteste le plus ;
 *   à défaut de tiers, la cible « aurait menti à toute la maison » ;
 * - `lie` : « l'acteur est secrètement allié à la cible ».
 */
export function falseFact(
  state: Readonly<SimState>,
  action: 'spread_rumor' | 'lie',
  actorId: Id,
  targetId: Id,
  volume: ActionVolume,
): FactInput {
  const sensitivity = sensitivityFor(2, volume);
  if (action === 'lie') {
    return { subjectId: actorId, predicate: 'est secrètement allié à', objectId: targetId, sensitivity };
  }
  const third = Object.keys(state.characters)
    .sort()
    .filter((id) => id !== actorId && id !== targetId && state.characters[id]?.status !== 'eliminated')
    .reduce<Id | null>(
      (best, id) =>
        best === null || relOf(state, actorId, id).rivalry > relOf(state, actorId, best).rivalry ? id : best,
      null,
    );
  return third === null
    ? { subjectId: targetId, predicate: 'aurait menti à', objectText: 'toute la maison', sensitivity }
    : { subjectId: third, predicate: 'aurait trahi', objectId: targetId, sensitivity };
}
