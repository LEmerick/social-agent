/**
 * Port d'embedding : transforme des textes en vecteurs de dimension fixe (pgvector, `vector(1024)`).
 * Les implémentations réelles (API d'embeddings) vivent hors du moteur ; `FakeEmbedding` (testkit) est déterministe.
 */
export interface EmbeddingPort {
  /** Dimension des vecteurs produits (1024 pour la table `memory`). */
  readonly dimensions: number;
  /** Un vecteur par texte, dans le même ordre ; chacun de longueur `dimensions`. */
  embed(texts: string[]): Promise<number[][]>;
}
