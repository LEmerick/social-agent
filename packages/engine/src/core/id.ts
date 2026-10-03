import type { Clock } from './clock.js';
import type { Rng } from './rng.js';

/**
 * Fabrique d'identifiants UUID v7 (horodatage ms + aléatoire).
 *
 * Le hasard vient d'un `Rng` à graine : mêmes graine et horloge ⇒ mêmes identifiants,
 * ce qui garde le rejeu d'une époque bit-à-bit identique.
 */
export interface IdFactory {
  next(): string;
}

export function createIdFactory(clock: Clock, rng: Rng): IdFactory {
  return {
    next: () => uuidV7(clock.now(), rng),
  };
}

export function uuidV7(unixMs: number, rng: Rng): string {
  if (!Number.isSafeInteger(unixMs) || unixMs < 0 || unixMs >= 2 ** 48) {
    throw new RangeError(`uuidV7: horodatage hors plage ${String(unixMs)}`);
  }
  const bytes = new Uint8Array(16);

  // 48 bits d'horodatage, big-endian.
  let rest = unixMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  for (let i = 6; i < 16; i++) {
    bytes[i] = rng.int(256);
  }
  // Masques appliqués sur des valeurs explicites : `x as T & m` ne masque pas à l'exécution.
  const versionByte = bytes[6] ?? 0;
  const variantByte = bytes[8] ?? 0;
  bytes[6] = (versionByte & 0x0f) | 0x70; // version 7
  bytes[8] = (variantByte & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
