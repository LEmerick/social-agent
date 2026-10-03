-- Le snapshot de relations garde désormais tout ce que porte une arête (parité avec storage-memory).
ALTER TABLE "relationship_snapshot"
  ADD COLUMN "interaction_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "first_met_event_id" UUID,
  ADD COLUMN "last_interaction_event_id" UUID,
  ADD COLUMN "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];
