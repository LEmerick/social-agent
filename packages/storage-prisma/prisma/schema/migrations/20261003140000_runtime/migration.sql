-- Compléments au port de stockage complet (M1).
--  * character_state.runtime : données de reprise (agenda, position, compteurs) ;
--  * event.seq : fourni par le moteur, unique par monde (et non plus global) ;
--  * effect.ord : ordre d'insertion des effets d'un même event ;
--  * float4 -> float8 pour confidence, importance, weight, impact (aller-retour exact des valeurs).
-- Les index memory_about_gin et memory_embedding_hnsw (migration constraints) sont volontairement conservés.

-- DropIndex
DROP INDEX "event_seq_key";

-- AlterTable
ALTER TABLE "character_state" ADD COLUMN     "runtime" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "effect" ADD COLUMN     "ord" BIGSERIAL NOT NULL;

-- AlterTable
ALTER TABLE "event" ALTER COLUMN "seq" DROP DEFAULT,
ALTER COLUMN "importance" SET DATA TYPE DOUBLE PRECISION;
DROP SEQUENCE "event_seq_seq";

-- AlterTable
ALTER TABLE "knowledge" ALTER COLUMN "confidence" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "score_entry" ALTER COLUMN "weight" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "impact" SET DATA TYPE DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "event_world_id_seq_key" ON "event"("world_id", "seq");
