/**
 * Rejeu : reconstruire l'état à partir des seuls effets (traçabilité, engine-architecture.md §12 / plan §5.2).
 * Les dimensions numériques viennent des effets ; les statuts, des events `status_changed`.
 */
import { DomainError } from '../core/errors.js';
import { applyEffect } from '../state/apply-effect.js';
import type { EffectInput, EffectRecord, EventRecord } from '../state/journal.js';
import type { CharacterStatus } from '../ports/storage.js';
import { AXIS_DEFAULTS, BASE_AXES, relKey, type Axis, type SimState } from '../state/types.js';

export interface ReplayOptions {
  /** Vérifie que chaque valeur recalculée égale `valueAfter` journalisée (défaut : oui). */
  readonly verify?: boolean;
}

/** Applique les effets, dans l'ordre du journal, sur une copie de `initialState`. */
export function replayEffects(
  initialState: Readonly<SimState>,
  effects: readonly EffectRecord[],
  options: ReplayOptions = {},
): SimState {
  const state = structuredClone(initialState) as SimState;
  for (const fx of effects) {
    const value = applyEffect(state, fx);
    if ((options.verify ?? true) && value !== fx.valueAfter) {
      throw new DomainError(
        'REPLAY_MISMATCH',
        `Effet ${fx.id} (${fx.ruleId}) : valeur rejouée ${String(value)} ≠ journalisée ${String(fx.valueAfter)}`,
      );
    }
  }
  return state;
}

/** Rejoue les transitions de statut (`status_changed`) sur `state` (mutation en place). */
export function replayStatuses(state: SimState, events: readonly EventRecord[]): SimState {
  for (const ev of events) {
    if (ev.type !== 'status_changed') continue;
    const { characterId, to, epochNumber } = ev.payload as {
      characterId: string;
      to: CharacterStatus;
      epochNumber: number;
    };
    const c = state.characters[characterId];
    if (!c) throw new DomainError('NOT_FOUND', `Personnage ${characterId} absent du SimState`);
    c.status = to;
    if (to === 'restricted') c.restrictedSinceEpoch = epochNumber;
    else if (to === 'active') c.restrictedSinceEpoch = null;
  }
  return state;
}

/** Chemin d'une valeur projetée affectée par un effet, ou `null` si l'effet n'a pas de valeur numérique. */
export function effectPath(fx: EffectInput, state: Readonly<SimState>): string | null {
  switch (fx.targetKind) {
    case 'relationship': {
      const key = relKey(fx.characterId, fx.otherCharacterId ?? '');
      return state.season.rules.relationshipAxes.includes(fx.dimension)
        ? `rel.${key}.extra.${fx.dimension}`
        : `rel.${key}.${fx.dimension}`;
    }
    case 'stat':
      return `char.${fx.characterId}.stats.${fx.dimension}`;
    case 'mood':
      return `char.${fx.characterId}.mood.${fx.dimension}`;
    case 'score':
      return `char.${fx.characterId}.scores.${fx.dimension}`;
    case 'credit':
      return `char.${fx.characterId}.credits`;
    default:
      return null;
  }
}

/** Toutes les valeurs numériques projetées par les effets, à plat (`chemin → valeur`). */
export function projectedValues(state: Readonly<SimState>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, c] of Object.entries(state.characters)) {
    for (const [k, v] of Object.entries(c.stats)) out[`char.${id}.stats.${k}`] = v;
    for (const [k, v] of Object.entries(c.mood)) out[`char.${id}.mood.${k}`] = v;
    for (const [k, v] of Object.entries(c.scores)) out[`char.${id}.scores.${k}`] = v;
    out[`char.${id}.credits`] = c.credits;
  }
  for (const [key, e] of Object.entries(state.relationships)) {
    for (const axis of BASE_AXES) {
      out[`rel.${key}.${axis}`] = e[axis];
    }
    for (const [k, v] of Object.entries(e.extraAxes)) out[`rel.${key}.extra.${k}`] = v;
  }
  return out;
}

/** Valeur d'une arête absente : une arête jamais créée équivaut à une arête par défaut. */
function absentValue(path: string): number | null {
  if (!path.startsWith('rel.')) return null;
  if (path.includes('.extra.')) return 0;
  const last = path.split('.').at(-1);
  return last !== undefined && last in AXIS_DEFAULTS ? AXIS_DEFAULTS[last as Axis] : null;
}

/**
 * Invariant de traçabilité : toute valeur projetée qui diffère entre `before` et `after` est couverte par au moins
 * un effet (une arête absente vaut l'arête par défaut). Renvoie la liste des chemins modifiés sans effet (vide si tout est traçable).
 */
export function untracedChanges(
  before: Readonly<SimState>,
  after: Readonly<SimState>,
  effects: readonly EffectInput[],
): string[] {
  const covered = new Set(effects.map((fx) => effectPath(fx, after)));
  const b = projectedValues(before);
  const a = projectedValues(after);
  return Object.keys({ ...b, ...a })
    .filter((path) => (b[path] ?? absentValue(path)) !== (a[path] ?? absentValue(path)) && !covered.has(path))
    .sort();
}
