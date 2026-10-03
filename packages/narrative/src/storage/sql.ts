/**
 * Tables `episode*` sur PostgreSQL, en SQL paramétré. Le client est structurel : un `PrismaClient` (ou le client
 * d'une transaction interactive) convient, sans que ce paquet dépende de Prisma. Sous le rôle `ai_reality_narrative`
 * seules ces tables sont inscriptibles.
 */
import { DomainError } from '@ai-reality/engine';
import type { Id } from '@ai-reality/engine';
import type { EpisodeLineRecord, EpisodeRecord, EpisodeSceneRecord, EpisodeStatus, EpisodeStore } from '../ports.js';
import type { Claim, Shot } from '../script.js';
import type { NarrativeArc, ValidationIssue } from '../types.js';

export interface SqlRunner {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface SqlClient extends SqlRunner {
  /** Absent sur le client d'une transaction déjà ouverte : les écritures s'y font alors directement. */
  $transaction?<R>(fn: (tx: SqlRunner) => Promise<R>): Promise<R>;
}

interface EpisodeRow {
  id: string;
  world_id: string;
  epoch_id: string;
  number: number;
  version: number;
  title: string;
  synopsis: string;
  status: EpisodeStatus;
  target_seconds: number;
  duration_seconds: number;
  cliffhanger: string | null;
  issues: ValidationIssue[];
}
interface SceneRow {
  id: string;
  episode_id: string;
  seq: number;
  location_id: string;
  tone: string;
  summary: string;
  seconds: number;
  character_ids: string[] | null;
  source_event_ids: string[] | null;
  shots: Shot[];
  claims: Claim[];
}
interface LineRow {
  id: string;
  episode_id: string;
  scene_id: string;
  seq: number;
  kind: EpisodeLineRecord['kind'];
  speaker_id: string | null;
  text: string;
  utterance_id: string | null;
  tone: string | null;
  llm_call_id: string | null;
}
interface ArcRow {
  id: string;
  world_id: string;
  title: string;
  status: NarrativeArc['status'];
  root_event_id: string;
  first_epoch_id: string;
  last_epoch_id: string;
  character_ids: string[] | null;
  event_ids: string[] | null;
  importance: number;
}
interface ArcLinkRow {
  episode_id: string;
  arc_id: string;
}

const json = (value: unknown): string => JSON.stringify(value);

const isUniqueViolation = (error: unknown): boolean => /23505|unique constraint|duplicate key/i.test(String(error));

export function sqlEpisodeStore(client: SqlClient): EpisodeStore {
  const inTx = <R>(fn: (tx: SqlRunner) => Promise<R>): Promise<R> =>
    client.$transaction ? client.$transaction(fn) : fn(client);

  return {
    async saveEpisode(e) {
      try {
        await inTx(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "episode" (id, world_id, epoch_id, number, version, title, synopsis, status, target_seconds, duration_seconds, cliffhanger, issues)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::episode_status, $9, $10, $11, $12::jsonb)`,
            e.id,
            e.worldId,
            e.epochId,
            e.number,
            e.version,
            e.title,
            e.synopsis,
            e.status,
            e.targetSeconds,
            e.durationSeconds,
            e.cliffhanger,
            json(e.issues),
          );
          for (const s of e.scenes) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "episode_scene" (id, episode_id, seq, location_id, tone, summary, seconds, character_ids, source_event_ids, shots, claims)
               VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8::uuid[], $9::uuid[], $10::jsonb, $11::jsonb)`,
              s.id,
              s.episodeId,
              s.seq,
              s.locationId,
              s.tone,
              s.summary,
              s.seconds,
              [...s.characterIds],
              [...s.sourceEventIds],
              json(s.shots),
              json(s.claims),
            );
          }
          for (const l of e.lines) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "episode_line" (id, episode_id, scene_id, seq, kind, speaker_id, text, utterance_id, tone, llm_call_id)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::episode_line_kind, $6::uuid, $7, $8::uuid, $9, $10::uuid)`,
              l.id,
              l.episodeId,
              l.sceneId,
              l.seq,
              l.kind,
              l.speakerId,
              l.text,
              l.utteranceId,
              l.tone,
              l.llmCallId,
            );
          }
          for (const arcId of e.arcIds) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "episode_arc" (episode_id, arc_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
              e.id,
              arcId,
            );
          }
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DomainError('DUPLICATE', `Épisode déjà enregistré (${e.epochId} v${String(e.version)})`);
        }
        throw error;
      }
    },

    async setStatus(episodeId, status, issues, durationSeconds) {
      const updated = await client.$executeRawUnsafe(
        `UPDATE "episode" SET status = $2::episode_status, issues = $3::jsonb, duration_seconds = $4, updated_at = now() WHERE id = $1::uuid`,
        episodeId,
        status,
        json(issues),
        durationSeconds,
      );
      if (updated === 0) throw new DomainError('NOT_FOUND', `Épisode ${episodeId} inconnu`);
    },

    async upsertArcs(arcs) {
      await inTx(async (tx) => {
        for (const a of arcs) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "narrative_arc" (id, world_id, title, status, root_event_id, first_epoch_id, last_epoch_id, character_ids, event_ids, importance)
             VALUES ($1::uuid, $2::uuid, $3, $4::arc_status, $5::uuid, $6::uuid, $7::uuid, $8::uuid[], $9::uuid[], $10)
             ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, last_epoch_id = EXCLUDED.last_epoch_id,
               character_ids = EXCLUDED.character_ids, event_ids = EXCLUDED.event_ids, importance = EXCLUDED.importance, updated_at = now()`,
            a.id,
            a.worldId,
            a.title,
            a.status,
            a.rootEventId,
            a.firstEpochId,
            a.lastEpochId,
            [...a.characterIds],
            [...a.eventIds],
            a.importance,
          );
        }
      });
    },

    async openArcs(worldId) {
      const rows = await client.$queryRawUnsafe<ArcRow[]>(
        `SELECT id, world_id, title, status, root_event_id, first_epoch_id, last_epoch_id, character_ids, event_ids, importance
         FROM "narrative_arc" WHERE world_id = $1::uuid AND status = 'open' ORDER BY id`,
        worldId,
      );
      return rows.map((r) => ({
        id: r.id,
        worldId: r.world_id,
        title: r.title,
        status: r.status,
        rootEventId: r.root_event_id,
        firstEpochId: r.first_epoch_id,
        lastEpochId: r.last_epoch_id,
        characterIds: r.character_ids ?? [],
        eventIds: r.event_ids ?? [],
        importance: r.importance,
      }));
    },

    async episodes(worldId) {
      const rows = await client.$queryRawUnsafe<EpisodeRow[]>(
        `SELECT id, world_id, epoch_id, number, version, title, synopsis, status, target_seconds, duration_seconds, cliffhanger, issues
         FROM "episode" WHERE world_id = $1::uuid ORDER BY number, version`,
        worldId,
      );
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const [scenes, lines, links] = await Promise.all([
        client.$queryRawUnsafe<SceneRow[]>(
          `SELECT id, episode_id, seq, location_id, tone, summary, seconds, character_ids, source_event_ids, shots, claims
           FROM "episode_scene" WHERE episode_id = ANY($1::uuid[]) ORDER BY episode_id, seq`,
          ids,
        ),
        client.$queryRawUnsafe<LineRow[]>(
          `SELECT id, episode_id, scene_id, seq, kind, speaker_id, text, utterance_id, tone, llm_call_id
           FROM "episode_line" WHERE episode_id = ANY($1::uuid[]) ORDER BY scene_id, seq`,
          ids,
        ),
        client.$queryRawUnsafe<ArcLinkRow[]>(
          `SELECT episode_id, arc_id FROM "episode_arc" WHERE episode_id = ANY($1::uuid[]) ORDER BY arc_id`,
          ids,
        ),
      ]);
      return rows.map((r): EpisodeRecord => {
        const episodeScenes: EpisodeSceneRecord[] = scenes
          .filter((s) => s.episode_id === r.id)
          .map((s) => ({
            id: s.id,
            episodeId: s.episode_id,
            seq: s.seq,
            locationId: s.location_id,
            tone: s.tone,
            summary: s.summary,
            seconds: s.seconds,
            characterIds: s.character_ids ?? [],
            sourceEventIds: s.source_event_ids ?? [],
            shots: s.shots,
            claims: s.claims,
          }));
        const episodeLines: EpisodeLineRecord[] = lines
          .filter((l) => l.episode_id === r.id)
          .map((l) => ({
            id: l.id,
            episodeId: l.episode_id,
            sceneId: l.scene_id,
            seq: l.seq,
            kind: l.kind,
            speakerId: l.speaker_id,
            text: l.text,
            utteranceId: l.utterance_id,
            tone: l.tone,
            llmCallId: l.llm_call_id,
          }));
        return {
          id: r.id,
          worldId: r.world_id,
          epochId: r.epoch_id,
          number: r.number,
          version: r.version,
          title: r.title,
          synopsis: r.synopsis,
          status: r.status,
          targetSeconds: r.target_seconds,
          durationSeconds: r.duration_seconds,
          cliffhanger: r.cliffhanger,
          issues: r.issues,
          arcIds: links.filter((x) => x.episode_id === r.id).map((x): Id => x.arc_id),
          scenes: episodeScenes,
          lines: episodeLines,
        };
      });
    },
  };
}
