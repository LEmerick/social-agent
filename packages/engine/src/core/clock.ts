/**
 * Horloge injectée. Le moteur ne lit jamais l'heure système : l'adaptateur (cli, serveur)
 * fournit l'implémentation réelle, les tests fournissent `ManualClock`.
 */
export interface Clock {
  /** Millisecondes depuis l'epoch Unix. */
  now(): number;
}

export class ManualClock implements Clock {
  #ms: number;

  constructor(startMs = 0) {
    if (!Number.isSafeInteger(startMs) || startMs < 0) {
      throw new RangeError(`ManualClock: instant invalide ${String(startMs)}`);
    }
    this.#ms = startMs;
  }

  now(): number {
    return this.#ms;
  }

  advance(deltaMs: number): void {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new RangeError(`ManualClock: avance invalide ${String(deltaMs)}`);
    }
    this.#ms += deltaMs;
  }
}
