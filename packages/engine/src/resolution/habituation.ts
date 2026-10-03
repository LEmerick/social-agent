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
