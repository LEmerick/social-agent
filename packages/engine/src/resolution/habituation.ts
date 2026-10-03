/**
 * Habituation (engine-architecture.md §9) : la n-ième répétition d'une même action du même acteur vers la même
 * cible dans la journée rapporte moins. Les compteurs sont dans `state.dailyCounts`, remis à zéro à chaque époque.
 *
 * Règle `habituation@1` : `count` = nombre de répétitions déjà faites aujourd'hui.
 *   1ʳᵉ et 2ᵉ fois (count 0, 1) : ×1 ; 3ᵉ fois (count 2) : ×0,5 ; 4ᵉ fois et au-delà (count ≥ 3) : ×0,25.
 */
import type { Id, SimState } from '../state/types.js';

export const HABITUATION_RULE = { id: 'habituation', version: 1 } as const;

export const habituationKey = (actorId: Id, action: string, targetId: Id | null): string =>
  `${actorId}|${action}|${targetId ?? ''}`;

export const habituationFactor = (count: number): number => (count < 2 ? 1 : count === 2 ? 0.5 : 0.25);

export const dailyCount = (state: Readonly<SimState>, key: string): number => state.dailyCounts[key] ?? 0;

/**
 * Mémoire courte de l'acteur pour la pénalité de répétition : `actor|action~last|target` = tick de la dernière fois + 1
 * (0 : jamais). La clé commence par `actorId|` (reprise avec le personnage, voir `runtimeOf`) et ne rencontre jamais une
 * clé d'habituation. Comme l'habituation, remis à zéro à chaque époque : « récemment » = depuis le début de la journée.
 */
export const lastKey = (actorId: Id, action: string, targetId: Id | null): string =>
  habituationKey(actorId, `${action}~last`, targetId);

/** Nombre de ticks écoulés depuis la dernière fois que l'acteur a fait cette action vers cette cible, ou `null`. */
export function ticksSinceLast(
  state: Readonly<SimState>,
  actorId: Id,
  action: string,
  targetId: Id | null,
): number | null {
  const stored = dailyCount(state, lastKey(actorId, action, targetId));
  return stored === 0 ? null : state.tick - (stored - 1);
}
