-- Exécuté une seule fois, à la création du volume.
-- pgvector : recherche vectorielle de la mémoire (M6).
-- btree_gist : contraintes d'exclusion sur les présences (M1).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;
