import type {
  CharacterStateRecord,
  EffectRecord,
  EventRecord,
  FactNode,
  KnowledgeEdge,
  RelationshipEdge,
} from '@ai-reality/engine';
import type { Prisma } from '@prisma/client';
import type {
  Effect as EffectRow,
  Event as EventRow,
  EventParticipant as EventParticipantRow,
  Fact as FactRow,
  CharacterState as CharacterStateRow,
  Knowledge as KnowledgeRow,
  Relationship as RelationshipRow,
  RelationshipSnapshot as SnapshotRow,
} from '@prisma/client';
import { asNumberRecord, asRecord, cmp } from './support.js';

export function toRelationshipEdge(r: RelationshipRow | SnapshotRow): RelationshipEdge {
  return {
    sourceId: r.sourceId,
    targetId: r.targetId,
    trust: r.trust,
    affection: r.affection,
    rivalry: r.rivalry,
    respect: r.respect,
    fear: r.fear,
    attraction: r.attraction,
    alliance: r.alliance,
    extraAxes: asNumberRecord(r.extraAxes),
    acquaintance: r.acquaintance,
    interactionCount: r.interactionCount,
    labels: [...r.labels],
    firstMetEventId: r.firstMetEventId,
    lastInteractionEventId: r.lastInteractionEventId,
  };
}

export const relationshipData = (e: RelationshipEdge) => ({
  trust: e.trust,
  affection: e.affection,
  rivalry: e.rivalry,
  respect: e.respect,
  fear: e.fear,
  attraction: e.attraction,
  alliance: e.alliance,
  extraAxes: e.extraAxes as Prisma.InputJsonObject,
  acquaintance: e.acquaintance,
  interactionCount: e.interactionCount,
  labels: [...e.labels],
  firstMetEventId: e.firstMetEventId,
  lastInteractionEventId: e.lastInteractionEventId,
});

export function toFactNode(f: FactRow): FactNode {
  return {
    id: f.id,
    subjectId: f.subjectId,
    predicate: f.predicate,
    objectId: f.objectId,
    objectText: f.objectText,
    isTrue: f.isTrue,
    sensitivity: f.sensitivity,
    originEventId: f.originEventId,
    inventedById: f.inventedById,
  };
}

export function toKnowledgeEdge(k: KnowledgeRow): KnowledgeEdge {
  return {
    id: k.id,
    characterId: k.characterId,
    factId: k.factId,
    sourceType: k.sourceType,
    toldById: k.toldById,
    viaEventId: k.viaEventId,
    parentKnowledgeId: k.parentKnowledgeId,
    learnedEpoch: k.learnedEpoch,
    learnedTick: k.learnedTick,
    confidence: k.confidence,
    belief: k.belief,
  };
}

export function toEventRecord(e: EventRow & { participants: EventParticipantRow[] }): EventRecord {
  return {
    id: e.id,
    epochId: e.epochId,
    tick: e.tick,
    seq: Number(e.seq),
    type: e.type,
    sceneId: e.sceneId,
    interactionId: e.interactionId,
    locationId: e.locationId,
    payload: asRecord(e.payload),
    importance: e.importance,
    causedByEventId: e.causedByEventId,
    participants: e.participants
      .map((p) => ({ characterId: p.characterId, role: p.role }))
      .sort((a, b) => cmp(a.characterId, b.characterId) || cmp(a.role, b.role)),
  };
}

export function toEffectRecord(e: EffectRow): EffectRecord {
  return {
    id: e.id,
    eventId: e.eventId,
    epochId: e.epochId,
    tick: e.tick,
    targetKind: e.targetKind,
    characterId: e.characterId,
    otherCharacterId: e.otherCharacterId,
    dimension: e.dimension,
    delta: e.delta,
    valueAfter: e.valueAfter,
    ruleId: e.ruleId,
    ruleVersion: e.ruleVersion,
    reason: e.reason,
  };
}

const STAT_COLUMNS = ['energy', 'morale', 'popularity', 'influence', 'reputation'] as const;

export function stateData(s: CharacterStateRecord) {
  return {
    energy: s.stats['energy'] ?? null,
    morale: s.stats['morale'] ?? null,
    popularity: s.stats['popularity'] ?? null,
    influence: s.stats['influence'] ?? null,
    reputation: s.stats['reputation'] ?? null,
    credits: s.credits,
    status: s.status,
    mood: s.mood as Prisma.InputJsonObject,
    scores: s.scores as Prisma.InputJsonObject,
    runtime: s.runtime as Prisma.InputJsonObject,
  };
}

export function toStateRecord(row: CharacterStateRow): CharacterStateRecord {
  const stats: Record<string, number> = {};
  for (const key of STAT_COLUMNS) {
    const value = row[key];
    if (value !== null) stats[key] = value;
  }
  return {
    characterId: row.characterId,
    epochId: row.epochId,
    stats,
    credits: row.credits ?? 0,
    status: row.status ?? 'active',
    mood: asNumberRecord(row.mood),
    scores: asNumberRecord(row.scores),
    runtime: asRecord(row.runtime),
  };
}
