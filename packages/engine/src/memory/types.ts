import type { MemoryRecord } from '../ports/storage.js';

export type { MemoryHit, MemoryKind, MemoryRecord, MemoryRepository } from '../ports/storage.js';

/** Souvenir à enregistrer : l'embedding est calculé par le service. */
export type MemoryDraft = Omit<MemoryRecord, 'embedding' | 'lastRecalledEpoch'>;

/** Réglages de la mémoire, tous exprimés en époques. */
export interface MemoryConfig {
  /** Demi-vie de la saillance (époques) : sans rappel, elle est divisée par deux tous les `halfLife`. */
  readonly halfLife: number;
  /** Part du chemin vers 1 gagnée à chaque rappel (0..1). */
  readonly recallBoost: number;
  /** Poids du score de rappel : saillance décrue, personnes concernées, similarité. */
  readonly weights: { readonly salience: number; readonly about: number; readonly similarity: number };
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  halfLife: 10,
  recallBoost: 0.3,
  weights: { salience: 0.35, about: 0.4, similarity: 0.25 },
};

/** Souvenir avec sa saillance effective à une époque donnée. */
export interface DecayedMemory {
  readonly record: MemoryRecord;
  /** Saillance après décroissance à l'époque demandée. */
  readonly salience: number;
}
