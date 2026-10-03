import { DomainError } from '../core/errors.js';
import type { EffectInput } from './journal.js';
import {
  AXIS_BOUNDS,
  AXIS_DEFAULTS,
  BASE_AXES,
  type Axis,
  type Id,
  type RelationshipEdge,
  SCORE_NAMES,
  type ScoreName,
  type SimState,
  STAT_KEYS,
  type StatKey,
  relKey,
} from './types.js';

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isAxis = (d: string): d is Axis => (BASE_AXES as readonly string[]).includes(d);
const isStat = (d: string): d is StatKey => (STAT_KEYS as readonly string[]).includes(d);
const isScore = (d: string): d is ScoreName => (SCORE_NAMES as readonly string[]).includes(d);

/** Arête par défaut entre deux personnages qui ne se connaissaient pas encore. */
export function defaultEdge(sourceId: Id, targetId: Id): RelationshipEdge {
  return {
    sourceId,
    targetId,
    ...AXIS_DEFAULTS,
    extraAxes: {},
    acquaintance: 'known_of',
    interactionCount: 0,
    labels: [],
    firstMetEventId: null,
    lastInteractionEventId: null,
  };
}

/** Renvoie l'arête source→cible, en la créant si besoin. */
export function edge(state: SimState, sourceId: Id, targetId: Id): RelationshipEdge {
  const key = relKey(sourceId, targetId);
  let e = state.relationships[key];
  if (!e) {
    e = defaultEdge(sourceId, targetId);
    state.relationships[key] = e;
  }
  return e;
}

/**
 * Applique un effet à l'état (mutation en place) et renvoie la valeur après clamp.
 * Seule fonction autorisée à modifier les dimensions numériques d'un `SimState`.
 * Renvoie `null` pour les effets sans valeur numérique (objets, missions, équipes : projetés par leurs events).
 */
export function applyEffect(state: SimState, fx: EffectInput): number | null {
  const character = state.characters[fx.characterId];
  if (!character) throw new DomainError('NOT_FOUND', `Personnage ${fx.characterId} absent du SimState`);

  switch (fx.targetKind) {
    case 'relationship': {
      if (!fx.otherCharacterId) throw new DomainError('INVALID_EFFECT', 'Effet de relation sans cible');
      const e = edge(state, fx.characterId, fx.otherCharacterId);
      if (isAxis(fx.dimension)) {
        const [min, max] = AXIS_BOUNDS[fx.dimension];
        e[fx.dimension] = clamp(e[fx.dimension] + fx.delta, min, max);
        return e[fx.dimension];
      }
      if (!state.season.rules.relationshipAxes.includes(fx.dimension)) {
        throw new DomainError('INVALID_EFFECT', `Axe de relation inconnu : ${fx.dimension}`);
      }
      const next = clamp((e.extraAxes[fx.dimension] ?? 0) + fx.delta, 0, 100);
      e.extraAxes[fx.dimension] = next;
      return next;
    }
    case 'stat': {
      if (!isStat(fx.dimension)) throw new DomainError('INVALID_EFFECT', `Stat inconnue : ${fx.dimension}`);
      character.stats[fx.dimension] = clamp(character.stats[fx.dimension] + fx.delta, 0, 100);
      return character.stats[fx.dimension];
    }
    case 'mood': {
      const next = clamp((character.mood[fx.dimension] ?? 0) + fx.delta, 0, 100);
      character.mood[fx.dimension] = next;
      return next;
    }
    case 'score': {
      if (!isScore(fx.dimension)) throw new DomainError('INVALID_EFFECT', `Score inconnu : ${fx.dimension}`);
      character.scores[fx.dimension] += fx.delta;
      return character.scores[fx.dimension];
    }
    case 'credit': {
      character.credits += fx.delta;
      return character.credits;
    }
    case 'goal':
    case 'item':
    case 'mission':
    case 'team':
      return null;
  }
}
