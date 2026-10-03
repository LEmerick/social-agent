-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "epoch_status" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "scene_kind" AS ENUM ('free', 'activity', 'meal', 'ceremony', 'confessional');

-- CreateEnum
CREATE TYPE "presence_kind" AS ENUM ('scene', 'transit', 'offstage');

-- CreateEnum
CREATE TYPE "character_autonomy" AS ENUM ('autonomous', 'guided', 'directive');

-- CreateEnum
CREATE TYPE "character_status" AS ENUM ('active', 'restricted', 'elimination_pending', 'eliminated', 'paused');

-- CreateEnum
CREATE TYPE "goal_kind" AS ENUM ('main', 'secondary', 'social', 'private');

-- CreateEnum
CREATE TYPE "goal_origin" AS ENUM ('player', 'ai', 'season');

-- CreateEnum
CREATE TYPE "interaction_type" AS ENUM ('social', 'relational', 'strategic', 'competitive', 'informational', 'collective');

-- CreateEnum
CREATE TYPE "interaction_mode" AS ENUM ('dialogue', 'summarized');

-- CreateEnum
CREATE TYPE "participant_role" AS ENUM ('speaker', 'addressee', 'bystander', 'eavesdropper');

-- CreateEnum
CREATE TYPE "volume" AS ENUM ('whisper', 'normal', 'loud');

-- CreateEnum
CREATE TYPE "event_participant_role" AS ENUM ('actor', 'target', 'witness', 'subject');

-- CreateEnum
CREATE TYPE "effect_target" AS ENUM ('stat', 'mood', 'relationship', 'score', 'credit', 'goal', 'item', 'mission', 'team');

-- CreateEnum
CREATE TYPE "acquaintance" AS ENUM ('known_of', 'met', 'acquainted', 'close');

-- CreateEnum
CREATE TYPE "knowledge_source" AS ENUM ('seeded', 'public', 'witnessed', 'overheard', 'told', 'inferred');

-- CreateEnum
CREATE TYPE "belief" AS ENUM ('believes', 'doubts', 'disbelieves');

-- CreateEnum
CREATE TYPE "credit_source" AS ENUM ('purchased', 'earned', 'system');

-- CreateEnum
CREATE TYPE "score_name" AS ENUM ('social', 'drama', 'popularity', 'survival', 'influence');

-- CreateEnum
CREATE TYPE "memory_kind" AS ENUM ('episodic', 'reflection');

-- CreateEnum
CREATE TYPE "decision_kind" AS ENUM ('action', 'outcome');

-- CreateEnum
CREATE TYPE "llm_purpose" AS ENUM ('plan', 'speak', 'evaluate', 'reflect');

-- CreateEnum
CREATE TYPE "item_kind" AS ENUM ('power', 'resource', 'clue', 'cosmetic');

-- CreateEnum
CREATE TYPE "item_state" AS ENUM ('active', 'used', 'expired', 'destroyed');

-- CreateEnum
CREATE TYPE "mission_scope" AS ENUM ('individual', 'team', 'all');

-- CreateEnum
CREATE TYPE "mission_secrecy" AS ENUM ('public', 'private', 'secret');

-- CreateEnum
CREATE TYPE "mission_status" AS ENUM ('active', 'succeeded', 'failed', 'expired', 'abandoned');

-- CreateEnum
CREATE TYPE "vote_kind" AS ENUM ('elimination', 'designation', 'public');

-- CreateEnum
CREATE TYPE "scheduled_kind" AS ENUM ('challenge', 'council', 'meal', 'announcement', 'item_drop', 'mission_assign', 'team_shuffle', 'merge', 'final');

-- CreateTable
CREATE TABLE "world" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "rules_version" INTEGER NOT NULL DEFAULT 1,
    "format" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "capacity" INTEGER,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "visual_ref" TEXT,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_zone" (
    "id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "hearing_range" TEXT NOT NULL DEFAULT 'zone',

    CONSTRAINT "location_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_route" (
    "from_location_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "travel_ticks" SMALLINT NOT NULL DEFAULT 1,

    CONSTRAINT "location_route_pkey" PRIMARY KEY ("from_location_id","to_location_id")
);

-- CreateTable
CREATE TABLE "character" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "slug" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "age" SMALLINT,
    "gender" TEXT,
    "origin" TEXT,
    "backstory" TEXT,
    "physical_description" TEXT,
    "speech_style" TEXT,
    "autonomy" "character_autonomy" NOT NULL,
    "persona_prompt" TEXT,
    "persona_version" INTEGER NOT NULL DEFAULT 1,
    "status" "character_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_visual" (
    "character_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "reference_images" TEXT[],
    "voice_id" TEXT,
    "wardrobe_id" TEXT,
    "visual_description" TEXT,
    "valid_from_epoch" INTEGER NOT NULL,

    CONSTRAINT "character_visual_pkey" PRIMARY KEY ("character_id","version")
);

-- CreateTable
CREATE TABLE "character_trait" (
    "character_id" UUID NOT NULL,
    "trait" TEXT NOT NULL,
    "value" SMALLINT NOT NULL,

    CONSTRAINT "character_trait_pkey" PRIMARY KEY ("character_id","trait")
);

-- CreateTable
CREATE TABLE "character_goal" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "kind" "goal_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "origin" "goal_origin" NOT NULL,
    "target_character_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_epoch" INTEGER,
    "closed_epoch" INTEGER,

    CONSTRAINT "character_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_directive" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "from_epoch" INTEGER NOT NULL,
    "to_epoch" INTEGER,
    "biases" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_directive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epoch" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "epoch_status" NOT NULL DEFAULT 'pending',
    "rng_seed" TEXT NOT NULL,
    "rules_version" INTEGER NOT NULL,
    "last_committed_tick" INTEGER NOT NULL DEFAULT -1,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "epoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene" (
    "id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "zone_id" UUID,
    "kind" "scene_kind" NOT NULL DEFAULT 'free',
    "tick_start" INTEGER NOT NULL,
    "tick_end" INTEGER,
    "title" TEXT,
    "importance" REAL,

    CONSTRAINT "scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presence" (
    "id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "tick_start" INTEGER NOT NULL,
    "tick_end" INTEGER,
    "kind" "presence_kind" NOT NULL,
    "scene_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "offstage_reason" TEXT,
    "role" TEXT,

    CONSTRAINT "presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction" (
    "id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "type" "interaction_type" NOT NULL,
    "initiator_id" UUID,
    "tick_start" INTEGER NOT NULL,
    "tick_end" INTEGER,
    "action" TEXT NOT NULL,
    "outcome" TEXT,
    "mode" "interaction_mode" NOT NULL DEFAULT 'dialogue',
    "classification" JSONB,

    CONSTRAINT "interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_participant" (
    "interaction_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "role" "participant_role" NOT NULL,
    "perceived_outcome" TEXT,
    "emotion_after" TEXT,

    CONSTRAINT "interaction_participant_pkey" PRIMARY KEY ("interaction_id","character_id")
);

-- CreateTable
CREATE TABLE "utterance" (
    "id" UUID NOT NULL,
    "interaction_id" UUID NOT NULL,
    "seq" SMALLINT NOT NULL,
    "tick" INTEGER NOT NULL,
    "speaker_id" UUID NOT NULL,
    "addressee_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "tone" TEXT,
    "emotion" TEXT,
    "volume" "volume" NOT NULL DEFAULT 'normal',
    "revealed_fact_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "llm_call_id" UUID,

    CONSTRAINT "utterance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision" (
    "id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "tick" INTEGER NOT NULL,
    "character_id" UUID NOT NULL,
    "kind" "decision_kind" NOT NULL,
    "options" JSONB NOT NULL,
    "chosen" JSONB NOT NULL,
    "policy" TEXT NOT NULL,
    "rng_draw" DOUBLE PRECISION,
    "interaction_id" UUID,
    "llm_call_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "tick" INTEGER NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "scene_id" UUID,
    "interaction_id" UUID,
    "location_id" UUID,
    "payload" JSONB NOT NULL,
    "importance" REAL NOT NULL DEFAULT 0,
    "caused_by_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participant" (
    "event_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "role" "event_participant_role" NOT NULL,

    CONSTRAINT "event_participant_pkey" PRIMARY KEY ("event_id","character_id","role")
);

-- CreateTable
CREATE TABLE "effect" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "tick" INTEGER NOT NULL,
    "target_kind" "effect_target" NOT NULL,
    "character_id" UUID NOT NULL,
    "other_character_id" UUID,
    "dimension" TEXT NOT NULL,
    "delta" SMALLINT NOT NULL,
    "value_after" SMALLINT,
    "rule_id" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "reason" TEXT,

    CONSTRAINT "effect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_call" (
    "id" UUID NOT NULL,
    "epoch_id" UUID,
    "character_id" UUID,
    "purpose" "llm_purpose" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_tokens" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship" (
    "world_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "trust" SMALLINT NOT NULL DEFAULT 30,
    "affection" SMALLINT NOT NULL DEFAULT 0,
    "rivalry" SMALLINT NOT NULL DEFAULT 0,
    "respect" SMALLINT NOT NULL DEFAULT 50,
    "fear" SMALLINT NOT NULL DEFAULT 0,
    "attraction" SMALLINT NOT NULL DEFAULT 0,
    "alliance" SMALLINT NOT NULL DEFAULT 0,
    "extra_axes" JSONB NOT NULL DEFAULT '{}',
    "acquaintance" "acquaintance" NOT NULL DEFAULT 'known_of',
    "first_met_event_id" UUID,
    "last_interaction_event_id" UUID,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "relationship_pkey" PRIMARY KEY ("source_id","target_id")
);

-- CreateTable
CREATE TABLE "relationship_snapshot" (
    "epoch_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "trust" SMALLINT NOT NULL,
    "affection" SMALLINT NOT NULL,
    "rivalry" SMALLINT NOT NULL,
    "respect" SMALLINT NOT NULL,
    "fear" SMALLINT NOT NULL,
    "attraction" SMALLINT NOT NULL,
    "alliance" SMALLINT NOT NULL,
    "extra_axes" JSONB NOT NULL,
    "acquaintance" "acquaintance" NOT NULL,

    CONSTRAINT "relationship_snapshot_pkey" PRIMARY KEY ("epoch_id","source_id","target_id")
);

-- CreateTable
CREATE TABLE "character_state" (
    "character_id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "energy" SMALLINT,
    "morale" SMALLINT,
    "popularity" SMALLINT,
    "influence" SMALLINT,
    "reputation" SMALLINT,
    "credits" INTEGER,
    "status" "character_status",
    "mood" JSONB NOT NULL DEFAULT '{}',
    "scores" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "character_state_pkey" PRIMARY KEY ("character_id","epoch_id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "epoch_id" UUID,
    "event_id" UUID,
    "amount" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "source" "credit_source" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_entry" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "score" "score_name" NOT NULL,
    "weight" REAL NOT NULL,
    "impact" REAL NOT NULL,
    "rule_id" TEXT NOT NULL,

    CONSTRAINT "score_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "subject_id" UUID,
    "predicate" TEXT NOT NULL,
    "object_id" UUID,
    "object_text" TEXT,
    "is_true" BOOLEAN NOT NULL,
    "sensitivity" SMALLINT NOT NULL DEFAULT 0,
    "origin_event_id" UUID,
    "invented_by_id" UUID,

    CONSTRAINT "fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "fact_id" UUID NOT NULL,
    "source_type" "knowledge_source" NOT NULL,
    "told_by_id" UUID,
    "via_event_id" UUID,
    "parent_knowledge_id" UUID,
    "learned_epoch" INTEGER NOT NULL,
    "learned_tick" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "belief" "belief" NOT NULL DEFAULT 'believes',

    CONSTRAINT "knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "event_id" UUID,
    "epoch_id" UUID NOT NULL,
    "kind" "memory_kind" NOT NULL DEFAULT 'episodic',
    "summary" TEXT NOT NULL,
    "emotion" TEXT,
    "salience" REAL NOT NULL,
    "about_character_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "embedding" vector(1024),
    "last_recalled_epoch" INTEGER,

    CONSTRAINT "memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_def" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "item_kind" NOT NULL,
    "effects" JSONB NOT NULL DEFAULT '{}',
    "transferable" BOOLEAN NOT NULL DEFAULT true,
    "expires_after_epoch" INTEGER,
    "visual_ref" TEXT,

    CONSTRAINT "item_def_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL,
    "item_def_id" UUID NOT NULL,
    "holder_character_id" UUID,
    "location_id" UUID,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "search_difficulty" SMALLINT,
    "is_fake" BOOLEAN NOT NULL DEFAULT false,
    "fake_of_item_def_id" UUID,
    "state" "item_state" NOT NULL DEFAULT 'active',

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_def" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "briefing" TEXT NOT NULL,
    "scope" "mission_scope" NOT NULL,
    "secrecy" "mission_secrecy" NOT NULL,
    "objective" JSONB NOT NULL,
    "failure" JSONB,
    "reward" JSONB NOT NULL,
    "penalty" JSONB,
    "deadline_epoch_offset" INTEGER,

    CONSTRAINT "mission_def_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_assignment" (
    "id" UUID NOT NULL,
    "mission_def_id" UUID NOT NULL,
    "character_id" UUID,
    "team_id" UUID,
    "assigned_event_id" UUID NOT NULL,
    "deadline_epoch" INTEGER,
    "status" "mission_status" NOT NULL DEFAULT 'active',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "resolved_event_id" UUID,

    CONSTRAINT "mission_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "camp_location_id" UUID,
    "created_epoch" INTEGER NOT NULL,
    "dissolved_epoch" INTEGER,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_membership" (
    "team_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "from_epoch" INTEGER NOT NULL,
    "to_epoch" INTEGER,
    "joined_event_id" UUID,

    CONSTRAINT "team_membership_pkey" PRIMARY KEY ("team_id","character_id","from_epoch")
);

-- CreateTable
CREATE TABLE "vote_session" (
    "id" UUID NOT NULL,
    "epoch_id" UUID NOT NULL,
    "tick" INTEGER NOT NULL,
    "scene_id" UUID,
    "kind" "vote_kind" NOT NULL,
    "electorate" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "result" JSONB,
    "event_id" UUID,

    CONSTRAINT "vote_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote" (
    "vote_session_id" UUID NOT NULL,
    "voter_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "decision_id" UUID,
    "revealed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vote_pkey" PRIMARY KEY ("vote_session_id","voter_id")
);

-- CreateTable
CREATE TABLE "scheduled_event" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "kind" "scheduled_kind" NOT NULL,
    "epoch" INTEGER,
    "tick_start" INTEGER,
    "tick_end" INTEGER,
    "trigger" JSONB,
    "location_id" UUID,
    "participants" JSONB NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "announced" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL DEFAULT '{}',
    "fired_event_id" UUID,

    CONSTRAINT "scheduled_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_world_id_number_key" ON "season"("world_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "location_world_id_slug_key" ON "location"("world_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "character_world_id_slug_key" ON "character"("world_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "epoch_world_id_number_key" ON "epoch"("world_id", "number");

-- CreateIndex
CREATE INDEX "scene_epoch_id_location_id_tick_start_idx" ON "scene"("epoch_id", "location_id", "tick_start");

-- CreateIndex
CREATE INDEX "presence_scene_id_idx" ON "presence"("scene_id");

-- CreateIndex
CREATE INDEX "presence_epoch_id_character_id_idx" ON "presence"("epoch_id", "character_id");

-- CreateIndex
CREATE UNIQUE INDEX "utterance_interaction_id_seq_key" ON "utterance"("interaction_id", "seq");

-- CreateIndex
CREATE INDEX "decision_epoch_id_character_id_tick_idx" ON "decision"("epoch_id", "character_id", "tick");

-- CreateIndex
CREATE UNIQUE INDEX "event_seq_key" ON "event"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "event_interaction_id_key" ON "event"("interaction_id");

-- CreateIndex
CREATE INDEX "event_epoch_id_tick_idx" ON "event"("epoch_id", "tick");

-- CreateIndex
CREATE INDEX "event_epoch_id_importance_idx" ON "event"("epoch_id", "importance" DESC);

-- CreateIndex
CREATE INDEX "effect_character_id_epoch_id_idx" ON "effect"("character_id", "epoch_id");

-- CreateIndex
CREATE INDEX "effect_character_id_other_character_id_idx" ON "effect"("character_id", "other_character_id");

-- CreateIndex
CREATE INDEX "llm_call_prompt_hash_idx" ON "llm_call"("prompt_hash");

-- CreateIndex
CREATE INDEX "knowledge_character_id_idx" ON "knowledge"("character_id");

-- CreateIndex
CREATE INDEX "knowledge_fact_id_idx" ON "knowledge"("fact_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_character_id_fact_id_via_event_id_key" ON "knowledge"("character_id", "fact_id", "via_event_id");

-- CreateIndex
CREATE INDEX "memory_character_id_salience_idx" ON "memory"("character_id", "salience" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "item_def_season_id_slug_key" ON "item_def"("season_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "mission_def_season_id_slug_key" ON "mission_def"("season_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "team_season_id_slug_key" ON "team"("season_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "vote_session_event_id_key" ON "vote_session"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_event_fired_event_id_key" ON "scheduled_event"("fired_event_id");

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_zone" ADD CONSTRAINT "location_zone_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_route" ADD CONSTRAINT "location_route_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_route" ADD CONSTRAINT "location_route_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_visual" ADD CONSTRAINT "character_visual_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_trait" ADD CONSTRAINT "character_trait_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_goal" ADD CONSTRAINT "character_goal_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_goal" ADD CONSTRAINT "character_goal_target_character_id_fkey" FOREIGN KEY ("target_character_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_directive" ADD CONSTRAINT "character_directive_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epoch" ADD CONSTRAINT "epoch_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epoch" ADD CONSTRAINT "epoch_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "location_zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_participant" ADD CONSTRAINT "interaction_participant_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "interaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_participant" ADD CONSTRAINT "interaction_participant_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utterance" ADD CONSTRAINT "utterance_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "interaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utterance" ADD CONSTRAINT "utterance_speaker_id_fkey" FOREIGN KEY ("speaker_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_caused_by_event_id_fkey" FOREIGN KEY ("caused_by_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effect" ADD CONSTRAINT "effect_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effect" ADD CONSTRAINT "effect_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effect" ADD CONSTRAINT "effect_other_character_id_fkey" FOREIGN KEY ("other_character_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_first_met_event_id_fkey" FOREIGN KEY ("first_met_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_last_interaction_event_id_fkey" FOREIGN KEY ("last_interaction_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_snapshot" ADD CONSTRAINT "relationship_snapshot_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_state" ADD CONSTRAINT "character_state_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_state" ADD CONSTRAINT "character_state_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entry" ADD CONSTRAINT "score_entry_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_invented_by_id_fkey" FOREIGN KEY ("invented_by_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_origin_event_id_fkey" FOREIGN KEY ("origin_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_fact_id_fkey" FOREIGN KEY ("fact_id") REFERENCES "fact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_told_by_id_fkey" FOREIGN KEY ("told_by_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_via_event_id_fkey" FOREIGN KEY ("via_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge" ADD CONSTRAINT "knowledge_parent_knowledge_id_fkey" FOREIGN KEY ("parent_knowledge_id") REFERENCES "knowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory" ADD CONSTRAINT "memory_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory" ADD CONSTRAINT "memory_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_def" ADD CONSTRAINT "item_def_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_item_def_id_fkey" FOREIGN KEY ("item_def_id") REFERENCES "item_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_fake_of_item_def_id_fkey" FOREIGN KEY ("fake_of_item_def_id") REFERENCES "item_def"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_holder_character_id_fkey" FOREIGN KEY ("holder_character_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_def" ADD CONSTRAINT "mission_def_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignment" ADD CONSTRAINT "mission_assignment_mission_def_id_fkey" FOREIGN KEY ("mission_def_id") REFERENCES "mission_def"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignment" ADD CONSTRAINT "mission_assignment_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignment" ADD CONSTRAINT "mission_assignment_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignment" ADD CONSTRAINT "mission_assignment_assigned_event_id_fkey" FOREIGN KEY ("assigned_event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignment" ADD CONSTRAINT "mission_assignment_resolved_event_id_fkey" FOREIGN KEY ("resolved_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_camp_location_id_fkey" FOREIGN KEY ("camp_location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_joined_event_id_fkey" FOREIGN KEY ("joined_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_session" ADD CONSTRAINT "vote_session_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "epoch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_session" ADD CONSTRAINT "vote_session_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_session" ADD CONSTRAINT "vote_session_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_vote_session_id_fkey" FOREIGN KEY ("vote_session_id") REFERENCES "vote_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_event" ADD CONSTRAINT "scheduled_event_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_event" ADD CONSTRAINT "scheduled_event_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_event" ADD CONSTRAINT "scheduled_event_fired_event_id_fkey" FOREIGN KEY ("fired_event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
