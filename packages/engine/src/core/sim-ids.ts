import { uuidV7, type IdFactory } from './id.js';
import { Rng } from './rng.js';
import type { WorldConfig } from '../state/types.js';

/**
 * Identifiants déterministes horodatés en temps simulé.
 *
 * Chaque (époque, tick, flux) a sa propre fabrique : une époque reprise au tick 17 produit
 * exactement les mêmes identifiants qu'une exécution sans interruption.
 */
export function simIdFactory(
  seed: string,
  config: Pick<WorldConfig, 'ticksPerEpoch' | 'tickMinutes' | 'startMs'>,
  epochNumber: number,
  tick: number,
  stream = 'ids',
): IdFactory {
  const rng = Rng.derive(seed, 'id', stream, epochNumber, tick);
  const ms = simTimeMs(config, epochNumber, tick);
  return { next: () => uuidV7(ms, rng) };
}

/** Instant (ms Unix) correspondant à un tick simulé. */
export function simTimeMs(
  config: Pick<WorldConfig, 'ticksPerEpoch' | 'tickMinutes' | 'startMs'>,
  epochNumber: number,
  tick: number,
): number {
  const ticks = epochNumber * config.ticksPerEpoch + tick;
  return config.startMs + ticks * config.tickMinutes * 60_000;
}
