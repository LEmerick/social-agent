import type { MemoryRecord } from '../ports/storage.js';
import type { DecayedMemory } from './types.js';

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Décroissance exponentielle : `salience × 0.5^(epochsElapsed / halfLife)`.
 * Après une demi-vie, la saillance est divisée par deux ; un délai négatif ou nul ne change rien.
 */
export function decay(salience: number, epochsElapsed: number, halfLife: number): number {
  if (!(halfLife > 0)) throw new RangeError(`halfLife doit être > 0 (reçu ${String(halfLife)})`);
  if (epochsElapsed <= 0) return salience;
  return salience * Math.pow(0.5, epochsElapsed / halfLife);
}

/**
 * Saillance effective de chaque souvenir à l'époque `epoch`. La référence est le dernier rappel
 * (`lastRecalledEpoch`), à défaut l'époque de création, lue dans `epochNumbers` (id d'époque → numéro).
 */
export function applyDecay(
  records: readonly MemoryRecord[],
  epoch: number,
  epochNumbers: ReadonlyMap<string, number>,
  halfLife: number,
): DecayedMemory[] {
  return records.map((record) => {
    const reference = record.lastRecalledEpoch ?? epochNumbers.get(record.epochId) ?? epoch;
    return { record, salience: decay(record.salience, epoch - reference, halfLife) };
  });
}

/**
 * Un souvenir rappelé remonte : on gagne une part `boost` du chemin vers 1 depuis sa saillance effective,
 * et son époque de référence devient `epoch` (la décroissance repart de là).
 */
export function recalled(
  item: DecayedMemory,
  epoch: number,
  boost: number,
): { salience: number; lastRecalledEpoch: number } {
  return { salience: clamp01(item.salience + (1 - item.salience) * boost), lastRecalledEpoch: epoch };
}
