import type { KnowledgeEdge, StorageTx } from '@ai-reality/engine';
import { type Db, cmp, guard } from './support.js';
import { commitTick, readJournal } from './journal.js';
import {
  relationshipData,
  toEventRecord,
  toFactNode,
  toKnowledgeEdge,
  toRelationshipEdge,
  toStateRecord,
} from './mappers.js';

type SimRepos = Pick<
  StorageTx,
  'relationships' | 'facts' | 'knowledge' | 'epochs' | 'journal' | 'characterStates' | 'snapshots'
>;

/** Ligne brute de la CTE de provenance (colonnes en snake_case). */
interface ProvenanceRow {
  id: string;
  character_id: string;
  fact_id: string;
  source_type: KnowledgeEdge['sourceType'];
  told_by_id: string | null;
  via_event_id: string | null;
  parent_knowledge_id: string | null;
  learned_epoch: number;
  learned_tick: number;
  confidence: number;
  belief: KnowledgeEdge['belief'];
}

/** Projections, connaissances, époques et journal. */
export function simRepos(db: Db): SimRepos {
  return {
    relationships: {
      async upsert(worldId, edges) {
        for (const e of edges) {
          const data = relationshipData(e);
          await guard(() =>
            db.relationship.upsert({
              where: { sourceId_targetId: { sourceId: e.sourceId, targetId: e.targetId } },
              create: { worldId, sourceId: e.sourceId, targetId: e.targetId, ...data },
              update: data,
            }),
          );
        }
      },
      async listByWorld(worldId) {
        const rows = await db.relationship.findMany({ where: { worldId } });
        return rows.map(toRelationshipEdge).sort((a, b) => cmp(a.sourceId, b.sourceId) || cmp(a.targetId, b.targetId));
      },
    },

    facts: {
      async insert(worldId, facts) {
        await guard(() => db.fact.createMany({ data: facts.map((f) => ({ ...f, worldId })) }));
      },
      async listByWorld(worldId) {
        const rows = await db.fact.findMany({ where: { worldId } });
        return rows.map(toFactNode).sort((a, b) => cmp(a.id, b.id));
      },
    },

    knowledge: {
      async insert(edges) {
        // Une par une : une connaissance peut avoir pour parent une autre du même lot.
        for (const k of edges) await guard(() => db.knowledge.create({ data: { ...k } }));
      },
      async listByWorld(worldId) {
        const rows = await db.knowledge.findMany({ where: { character: { worldId } } });
        return rows.map(toKnowledgeEdge).sort((a, b) => cmp(a.characterId, b.characterId) || cmp(a.id, b.id));
      },
      async provenance(characterId, factId) {
        const rows = await db.$queryRaw<ProvenanceRow[]>`
          WITH RECURSIVE start AS (
            SELECT id FROM knowledge
            WHERE character_id = ${characterId}::uuid AND fact_id = ${factId}::uuid
            ORDER BY learned_epoch, learned_tick, id
            LIMIT 1
          ), chain AS (
            SELECT k.*, 0 AS depth FROM knowledge k JOIN start s ON s.id = k.id
            UNION ALL
            SELECT p.*, chain.depth + 1 FROM knowledge p JOIN chain ON p.id = chain.parent_knowledge_id
            WHERE chain.depth < 1000
          )
          SELECT id, character_id, fact_id, source_type, told_by_id, via_event_id, parent_knowledge_id,
                 learned_epoch, learned_tick, confidence, belief
          FROM chain ORDER BY depth DESC`;
        return rows.map((r) => ({
          id: r.id,
          characterId: r.character_id,
          factId: r.fact_id,
          sourceType: r.source_type,
          toldById: r.told_by_id,
          viaEventId: r.via_event_id,
          parentKnowledgeId: r.parent_knowledge_id,
          learnedEpoch: r.learned_epoch,
          learnedTick: r.learned_tick,
          confidence: r.confidence,
          belief: r.belief,
        }));
      },
    },

    epochs: {
      async insert(epoch) {
        await guard(() => db.epoch.create({ data: { ...epoch } }));
      },
      async findByNumber(worldId, number) {
        const row = await db.epoch.findUnique({ where: { worldId_number: { worldId, number } } });
        return row ? toEpochRecord(row) : undefined;
      },
      async findById(id) {
        const row = await db.epoch.findUnique({ where: { id } });
        return row ? toEpochRecord(row) : undefined;
      },
      async setStatus(id, status) {
        await guard(() => db.epoch.update({ where: { id }, data: { status } }));
      },
    },

    journal: {
      commitTick: (batch) => commitTick(db, batch),
      read: (epochId) => readJournal(db, epochId),
      async eventsOfWorld(worldId) {
        const rows = await db.event.findMany({
          where: { worldId },
          include: { participants: true },
          orderBy: { seq: 'asc' },
        });
        return rows.map(toEventRecord);
      },
    },

    characterStates: {
      async latest(worldId) {
        const rows = await db.characterState.findMany({
          where: { character: { worldId } },
          include: { epoch: { select: { number: true } } },
          orderBy: { epoch: { number: 'desc' } },
        });
        const seen = new Set<string>();
        const latest = [];
        for (const row of rows) {
          if (seen.has(row.characterId)) continue;
          seen.add(row.characterId);
          latest.push(toStateRecord(row));
        }
        return latest.sort((a, b) => cmp(a.characterId, b.characterId));
      },
      async listByEpoch(epochId) {
        const rows = await db.characterState.findMany({ where: { epochId } });
        return rows.map(toStateRecord).sort((a, b) => cmp(a.characterId, b.characterId));
      },
    },

    snapshots: {
      async saveRelationships(epochId, edges) {
        await guard(async () => {
          await db.relationshipSnapshot.deleteMany({ where: { epochId } });
          await db.relationshipSnapshot.createMany({
            data: edges.map((e) => ({
              epochId,
              sourceId: e.sourceId,
              targetId: e.targetId,
              trust: e.trust,
              affection: e.affection,
              rivalry: e.rivalry,
              respect: e.respect,
              fear: e.fear,
              attraction: e.attraction,
              alliance: e.alliance,
              extraAxes: e.extraAxes,
              acquaintance: e.acquaintance,
            })),
          });
        });
      },
      async relationships(epochId) {
        const rows = await db.relationshipSnapshot.findMany({ where: { epochId } });
        return rows.map(toRelationshipEdge).sort((a, b) => cmp(a.sourceId, b.sourceId) || cmp(a.targetId, b.targetId));
      },
    },
  };
}

function toEpochRecord(row: {
  id: string;
  worldId: string;
  seasonId: string;
  number: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  rngSeed: string;
  rulesVersion: number;
  lastCommittedTick: number;
}) {
  return {
    id: row.id,
    worldId: row.worldId,
    seasonId: row.seasonId,
    number: row.number,
    status: row.status,
    rngSeed: row.rngSeed,
    rulesVersion: row.rulesVersion,
    lastCommittedTick: row.lastCommittedTick,
  };
}
