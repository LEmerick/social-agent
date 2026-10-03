-- Narration (M10) : tables episode_*, narrative_arc et rôle SQL en lecture seule sur la simulation.
-- L'index HNSW de memory (migration constraints) est volontairement conservé.

-- CreateEnum
CREATE TYPE "episode_status" AS ENUM ('draft', 'validated', 'rejected');

-- CreateEnum
CREATE TYPE "arc_status" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "episode_line_kind" AS ENUM ('dialogue', 'confessional', 'voiceover');

-- CreateTable
CREATE TABLE "episode" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "status" "episode_status" NOT NULL DEFAULT 'draft',
    "target_seconds" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "cliffhanger" TEXT,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "narrative_arc" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "arc_status" NOT NULL DEFAULT 'open',
    "root_event_id" UUID NOT NULL,
    "first_epoch_id" UUID NOT NULL,
    "last_epoch_id" UUID NOT NULL,
    "character_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "event_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narrative_arc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_arc" (
    "episode_id" UUID NOT NULL,
    "arc_id" UUID NOT NULL,

    CONSTRAINT "episode_arc_pkey" PRIMARY KEY ("episode_id","arc_id")
);

-- CreateTable
CREATE TABLE "episode_scene" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "location_id" UUID NOT NULL,
    "tone" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "character_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "source_event_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "shots" JSONB NOT NULL DEFAULT '[]',
    "claims" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "episode_scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_line" (
    "id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "episode_line_kind" NOT NULL,
    "speaker_id" UUID,
    "text" TEXT NOT NULL,
    "utterance_id" UUID,
    "tone" TEXT,
    "llm_call_id" UUID,

    CONSTRAINT "episode_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "episode_world_id_number_idx" ON "episode"("world_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "episode_epoch_id_version_key" ON "episode"("epoch_id", "version");

-- CreateIndex
CREATE INDEX "narrative_arc_world_id_status_idx" ON "narrative_arc"("world_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "episode_scene_episode_id_seq_key" ON "episode_scene"("episode_id", "seq");

-- CreateIndex
CREATE INDEX "episode_line_episode_id_idx" ON "episode_line"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "episode_line_scene_id_seq_key" ON "episode_line"("scene_id", "seq");

-- AddForeignKey
ALTER TABLE "episode_arc" ADD CONSTRAINT "episode_arc_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_arc" ADD CONSTRAINT "episode_arc_arc_id_fkey" FOREIGN KEY ("arc_id") REFERENCES "narrative_arc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_scene" ADD CONSTRAINT "episode_scene_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_line" ADD CONSTRAINT "episode_line_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_line" ADD CONSTRAINT "episode_line_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "episode_scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Contraintes non exprimables en Prisma ─────
ALTER TABLE "episode" ADD CONSTRAINT "episode_seconds_check" CHECK (target_seconds > 0 AND duration_seconds >= 0);
ALTER TABLE "episode" ADD CONSTRAINT "episode_version_check" CHECK (version >= 1);
ALTER TABLE "episode_scene" ADD CONSTRAINT "episode_scene_seconds_check" CHECK (seconds >= 0);

-- ───── Droits : la narration lit toute la simulation et n'écrit que ses propres tables ─────
-- Le rôle ne peut ni supprimer ni toucher aux tables de simulation : INSERT/UPDATE/SELECT sur episode, episode_*
-- et narrative_arc uniquement (pas de DELETE : un épisode rejeté se remplace par une nouvelle version).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_reality_narrative') THEN
    CREATE ROLE ai_reality_narrative NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ai_reality_narrative;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ai_reality_narrative;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_reality_narrative;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ai_reality_narrative;
GRANT INSERT, UPDATE ON "episode", "episode_arc", "episode_scene", "episode_line", "narrative_arc" TO ai_reality_narrative;
