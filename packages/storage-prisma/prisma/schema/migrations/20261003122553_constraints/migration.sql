-- Contraintes non exprimables en Prisma (docs/database-model.md, docs/database-prisma.md).
-- Idempotente : chaque contrainte est supprimée avant d'être recréée.

-- ───── Présence : un personnage n'a jamais deux segments qui se chevauchent dans une époque ─────
ALTER TABLE "presence" DROP CONSTRAINT IF EXISTS "presence_no_overlap";
ALTER TABLE "presence" ADD CONSTRAINT "presence_no_overlap"
  EXCLUDE USING gist (epoch_id WITH =, character_id WITH =, int4range(tick_start, tick_end) WITH &&);

ALTER TABLE "presence" DROP CONSTRAINT IF EXISTS "presence_tick_order";
ALTER TABLE "presence" ADD CONSTRAINT "presence_tick_order"
  CHECK (tick_end IS NULL OR tick_end > tick_start);

ALTER TABLE "presence" DROP CONSTRAINT IF EXISTS "presence_scene_consistency";
ALTER TABLE "presence" ADD CONSTRAINT "presence_scene_consistency"
  CHECK ((kind = 'scene') = (scene_id IS NOT NULL));

ALTER TABLE "presence" DROP CONSTRAINT IF EXISTS "presence_transit_consistency";
ALTER TABLE "presence" ADD CONSTRAINT "presence_transit_consistency"
  CHECK ((kind = 'transit') = (to_location_id IS NOT NULL));

-- ───── Scènes et interactions ─────
ALTER TABLE "scene" DROP CONSTRAINT IF EXISTS "scene_tick_order";
ALTER TABLE "scene" ADD CONSTRAINT "scene_tick_order"
  CHECK (tick_end IS NULL OR tick_end > tick_start);

ALTER TABLE "interaction" DROP CONSTRAINT IF EXISTS "interaction_tick_order";
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_tick_order"
  CHECK (tick_end IS NULL OR tick_end > tick_start);

-- ───── Dimensions bornées ─────
ALTER TABLE "character_trait" DROP CONSTRAINT IF EXISTS "character_trait_value_range";
ALTER TABLE "character_trait" ADD CONSTRAINT "character_trait_value_range"
  CHECK (value BETWEEN 0 AND 100);

ALTER TABLE "fact" DROP CONSTRAINT IF EXISTS "fact_sensitivity_range";
ALTER TABLE "fact" ADD CONSTRAINT "fact_sensitivity_range"
  CHECK (sensitivity BETWEEN 0 AND 3);

ALTER TABLE "knowledge" DROP CONSTRAINT IF EXISTS "knowledge_confidence_range";
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_confidence_range"
  CHECK (confidence BETWEEN 0 AND 1);

ALTER TABLE "item" DROP CONSTRAINT IF EXISTS "item_search_difficulty_range";
ALTER TABLE "item" ADD CONSTRAINT "item_search_difficulty_range"
  CHECK (search_difficulty BETWEEN 0 AND 100);

-- ───── Relations : axes bornés, pas de relation avec soi-même ─────
ALTER TABLE "relationship" DROP CONSTRAINT IF EXISTS "relationship_axes_range";
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_axes_range"
  CHECK (
    trust BETWEEN 0 AND 100
    AND affection BETWEEN -100 AND 100
    AND rivalry BETWEEN 0 AND 100
    AND respect BETWEEN 0 AND 100
    AND fear BETWEEN 0 AND 100
    AND attraction BETWEEN 0 AND 100
    AND alliance BETWEEN 0 AND 100
  );

ALTER TABLE "relationship" DROP CONSTRAINT IF EXISTS "relationship_not_self";
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_not_self"
  CHECK (source_id <> target_id);

ALTER TABLE "relationship_snapshot" DROP CONSTRAINT IF EXISTS "relationship_snapshot_axes_range";
ALTER TABLE "relationship_snapshot" ADD CONSTRAINT "relationship_snapshot_axes_range"
  CHECK (
    trust BETWEEN 0 AND 100
    AND affection BETWEEN -100 AND 100
    AND rivalry BETWEEN 0 AND 100
    AND respect BETWEEN 0 AND 100
    AND fear BETWEEN 0 AND 100
    AND attraction BETWEEN 0 AND 100
    AND alliance BETWEEN 0 AND 100
  );

-- ───── Objets et missions : cardinalités ─────
-- Un objet a au plus un emplacement : porteur OU lieu.
ALTER TABLE "item" DROP CONSTRAINT IF EXISTS "item_single_location";
ALTER TABLE "item" ADD CONSTRAINT "item_single_location"
  CHECK (num_nonnulls(holder_character_id, location_id) <= 1);

-- Une mission est attribuée à exactement un personnage ou une équipe.
ALTER TABLE "mission_assignment" DROP CONSTRAINT IF EXISTS "mission_assignment_single_owner";
ALTER TABLE "mission_assignment" ADD CONSTRAINT "mission_assignment_single_owner"
  CHECK (num_nonnulls(character_id, team_id) = 1);

-- ───── Index non exprimables en Prisma ─────
CREATE INDEX IF NOT EXISTS "memory_about_gin" ON "memory" USING gin (about_character_ids);
CREATE INDEX IF NOT EXISTS "memory_embedding_hnsw" ON "memory" USING hnsw (embedding vector_cosine_ops);

-- ───── Append-only : le rôle applicatif ne peut ni modifier ni supprimer ─────
-- Le propriétaire du schéma (migrations) garde tous les droits ; l'application se connecte
-- avec ai_reality_app, puis SET ROLE pour les tests.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_reality_app') THEN
    CREATE ROLE ai_reality_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ai_reality_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ai_reality_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_reality_app;

REVOKE UPDATE, DELETE ON "event", "effect", "utterance", "credit_ledger", "decision" FROM ai_reality_app;
