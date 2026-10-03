/** Dimension de la colonne `memory.embedding`. */
export const EMBEDDING_DIMENSIONS = 1024;

/** Hachage FNV-1a 32 bits : stable, sans dépendance. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Embedding factice et déterministe : sac de mots haché. Chaque mot (minuscules, sans accents, 3 lettres ou plus)
 * incrémente une composante choisie par son hachage ; le vecteur est normalisé (norme 1). Deux textes qui
 * partagent des mots ont un cosinus élevé ; deux textes sans mot commun sont (presque toujours) orthogonaux.
 * Structurellement conforme à l'`EmbeddingPort` du moteur.
 */
export class FakeEmbedding {
  readonly dimensions: number;

  constructor(dimensions = EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.vectorOf(text)));
  }

  /** Version synchrone, pratique pour construire des données de test. */
  vectorOf(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const words = text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    for (const word of words) vector[fnv1a(word) % this.dimensions] = (vector[fnv1a(word) % this.dimensions] ?? 0) + 1;
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    // Texte sans mot exploitable : vecteur unitaire fixe (la distance cosinus d'un vecteur nul est indéfinie).
    if (norm === 0) {
      vector[0] = 1;
      return vector;
    }
    return vector.map((x) => x / norm);
  }
}
