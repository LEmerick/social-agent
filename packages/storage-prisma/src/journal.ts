import type {
  EpochJournal,
  InteractionRecord,
  LedgerRecord,
  PresenceRecord,
  SceneRecord,
  TickBatch,
  UtteranceRecord,
} from '@ai-reality/engine';
import { DomainError } from '@ai-reality/engine';
import type { Prisma } from '@prisma/client';
import { stateData, relationshipData, toEffectRecord, toEventRecord } from './mappers.js';
import { type Db, asRecord, cmp, guard, toJson, toNullableJson } from './support.js';

/** Écrit tout un tick. Les fermetures passent avant les ouvertures (contrainte d'exclusion sur `presence`). */
export async function commitTick(db: Db, batch: TickBatch): Promise<void> {
  const epoch = await db.epoch.findUnique({ where: { id: batch.epochId }, select: { id: true, worldId: true } });
  if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${batch.epochId} introuvable`);
  const worldId = epoch.worldId;

  await guard(async () => {
    for (const c of batch.scenesClosed) {
      await db.scene.update({ where: { id: c.id }, data: { tickEnd: c.tickEnd } });
    }
    for (const c of batch.presencesClosed) {
      await db.presence.update({ where: { id: c.id }, data: { tickEnd: c.tickEnd } });
    }

    await db.scene.createMany({ data: batch.scenesOpened.map((s) => ({ ...s })) });
    await db.presence.createMany({ data: batch.presencesOpened.map((p) => ({ ...p })) });

    for (const i of batch.interactions) {
      await db.interaction.create({
        data: {
          id: i.id,
          sceneId: i.sceneId,
          type: i.type,
          initiatorId: i.initiatorId,
          tickStart: i.tickStart,
          tickEnd: i.tickEnd,
          action: i.action,
          outcome: i.outcome,
          mode: i.mode,
          classification: toNullableJson(i.classification),
          participants: { create: i.participants.map((p) => ({ characterId: p.characterId, role: p.role })) },
        },
      });
    }
    await db.utterance.createMany({
      data: batch.utterances.map((u) => ({
        ...u,
        addresseeIds: [...u.addresseeIds],
        revealedFactIds: [...u.revealedFactIds],
      })),
    });
    await db.decision.createMany({
      data: batch.decisions.map((d) => ({ ...d, options: toJson(d.options), chosen: toJson(d.chosen) })),
    });

    // Dans l'ordre de `seq` : une cause précède ses conséquences.
    for (const e of [...batch.events].sort((a, b) => a.seq - b.seq)) {
      const { participants, seq, payload, ...rest } = e;
      await db.event.create({
        data: {
          ...rest,
          worldId,
          seq: BigInt(seq),
          payload: payload as Prisma.InputJsonObject,
          participants: { create: participants.map((p) => ({ characterId: p.characterId, role: p.role })) },
        },
      });
    }
    await db.effect.createMany({ data: batch.effects.map((e) => ({ ...e })) });

    await db.fact.createMany({ data: batch.facts.map((f) => ({ ...f, worldId })) });
    for (const k of batch.knowledge) await db.knowledge.create({ data: { ...k } });

    await db.creditLedger.createMany({ data: batch.ledger.map((l) => ({ ...l })) });
    await db.scoreEntry.createMany({ data: batch.scoreEntries.map((s) => ({ ...s })) });

    for (const r of batch.relationships) {
      const data = relationshipData(r);
      await db.relationship.upsert({
        where: { sourceId_targetId: { sourceId: r.sourceId, targetId: r.targetId } },
        create: { worldId, sourceId: r.sourceId, targetId: r.targetId, ...data },
        update: data,
      });
    }
    for (const s of batch.characterStates) {
      const data = stateData(s);
      await db.characterState.upsert({
        where: { characterId_epochId: { characterId: s.characterId, epochId: s.epochId } },
        create: { characterId: s.characterId, epochId: s.epochId, ...data },
        update: data,
      });
    }

    for (const g of batch.goals) {
      const { id, createdEpoch, ...update } = g;
      await db.characterGoal.upsert({ where: { id }, create: { id, createdEpoch, ...update }, update });
    }

    await db.epoch.update({ where: { id: batch.epochId }, data: { lastCommittedTick: batch.tick } });
  });
}

export async function readJournal(db: Db, epochId: string): Promise<EpochJournal> {
  const [scenes, presences, interactions, utterances, decisions, events, effects, ledger, scoreEntries] =
    await Promise.all([
      db.scene.findMany({ where: { epochId } }),
      db.presence.findMany({ where: { epochId } }),
      db.interaction.findMany({
        where: { scene: { epochId } },
        include: { participants: true, scene: { select: { epochId: true } } },
      }),
      db.utterance.findMany({ where: { interaction: { scene: { epochId } } } }),
      db.decision.findMany({ where: { epochId } }),
      db.event.findMany({ where: { epochId }, include: { participants: true }, orderBy: { seq: 'asc' } }),
      db.effect.findMany({ where: { epochId }, orderBy: { ord: 'asc' } }),
      db.creditLedger.findMany({ where: { epochId } }),
      db.scoreEntry.findMany({ where: { epochId } }),
    ]);

  const eventRecords = events.map(toEventRecord);
  const seqOf = new Map(eventRecords.map((e) => [e.id, e.seq]));

  return {
    scenes: scenes
      .map((s): SceneRecord => ({
        id: s.id,
        epochId: s.epochId,
        locationId: s.locationId,
        zoneId: s.zoneId,
        kind: s.kind,
        tickStart: s.tickStart,
        tickEnd: s.tickEnd,
      }))
      .sort((a, b) => a.tickStart - b.tickStart || cmp(a.id, b.id)),
    presences: presences
      .map((p): PresenceRecord => ({
        id: p.id,
        epochId: p.epochId,
        characterId: p.characterId,
        tickStart: p.tickStart,
        tickEnd: p.tickEnd,
        kind: p.kind,
        sceneId: p.sceneId,
        fromLocationId: p.fromLocationId,
        toLocationId: p.toLocationId,
        offstageReason: p.offstageReason,
        role: p.role as PresenceRecord['role'],
      }))
      .sort((a, b) => cmp(a.characterId, b.characterId) || a.tickStart - b.tickStart || cmp(a.id, b.id)),
    interactions: interactions
      .map((i): InteractionRecord => ({
        id: i.id,
        epochId: i.scene.epochId,
        sceneId: i.sceneId,
        type: i.type,
        initiatorId: i.initiatorId,
        tickStart: i.tickStart,
        tickEnd: i.tickEnd,
        action: i.action,
        outcome: i.outcome,
        mode: i.mode,
        classification: i.classification === null ? null : asRecord(i.classification),
        participants: i.participants
          .map((p) => ({ characterId: p.characterId, role: p.role }))
          .sort((a, b) => cmp(a.characterId, b.characterId) || cmp(a.role, b.role)),
      }))
      .sort((a, b) => a.tickStart - b.tickStart || cmp(a.id, b.id)),
    utterances: utterances
      .map((u): UtteranceRecord => ({
        id: u.id,
        interactionId: u.interactionId,
        seq: u.seq,
        tick: u.tick,
        speakerId: u.speakerId,
        addresseeIds: [...u.addresseeIds],
        text: u.text,
        intent: u.intent,
        tone: u.tone,
        emotion: u.emotion,
        volume: u.volume,
        revealedFactIds: [...u.revealedFactIds],
        llmCallId: u.llmCallId,
      }))
      .sort((a, b) => cmp(a.interactionId, b.interactionId) || a.seq - b.seq),
    decisions: decisions
      .map((d) => ({
        id: d.id,
        epochId: d.epochId,
        tick: d.tick,
        characterId: d.characterId,
        kind: d.kind,
        options: d.options,
        chosen: d.chosen,
        policy: d.policy,
        rngDraw: d.rngDraw,
        interactionId: d.interactionId,
        llmCallId: d.llmCallId,
      }))
      .sort((a, b) => a.tick - b.tick || cmp(a.id, b.id)),
    events: eventRecords,
    // `sort` est stable : à seq égal, l'ordre d'insertion (`ord`) est conservé.
    effects: effects.map(toEffectRecord).sort((a, b) => (seqOf.get(a.eventId) ?? 0) - (seqOf.get(b.eventId) ?? 0)),
    ledger: ledger
      .map((l): LedgerRecord => ({
        id: l.id,
        characterId: l.characterId,
        epochId: l.epochId,
        eventId: l.eventId,
        amount: l.amount,
        category: l.category as LedgerRecord['category'],
        source: l.source,
      }))
      .sort((a, b) => cmp(a.id, b.id)),
    scoreEntries: scoreEntries
      .map((s) => ({
        id: s.id,
        characterId: s.characterId,
        epochId: s.epochId,
        eventId: s.eventId,
        score: s.score,
        weight: s.weight,
        impact: s.impact,
        ruleId: s.ruleId,
      }))
      .sort((a, b) => cmp(a.id, b.id)),
  };
}
