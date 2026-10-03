/**
 * Générateur pseudo-aléatoire à graine (mulberry32). Déterministe : même graine ⇒ même suite.
 *
 * Les sous-graines sont dérivées par hachage (`Rng.derive`), par exemple
 * `Rng.derive(seed, epoch, tick, characterId)`, pour que les flux soient indépendants.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Crée un générateur dont la graine dépend de toutes les parties données (ordre compris). */
  static derive(seed: string, ...parts: ReadonlyArray<string | number>): Rng {
    const material = [seed, ...parts.map(String)].join('|');
    return new Rng(cyrb53(material));
  }

  /** Flottant uniforme dans [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier uniforme dans [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`Rng.int: borne invalide ${String(maxExclusive)}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Élément uniforme d'un tableau non vide. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Rng.pick: tableau vide');
    }
    return items[this.int(items.length)] as T;
  }
}

/** Hachage de chaîne 53 bits (cyrb53), stable entre versions de moteur JavaScript. */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
