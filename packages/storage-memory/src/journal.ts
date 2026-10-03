import type { EffectRecord, EpochJournal, KnowledgeEdge, TickBatch } from '@ai-reality/engine';
import { DomainError } from '@ai-reality/engine';
import { type Db, checkEdge, cmp, copy, duplicate, notFound, overlaps, require_ } from './db.js';

function put<T extends { id: string }>(map: Map<string, T>, record: T, what: string): void {
  if (map.has(record.id)) throw duplicate(`${what} ${record.id}`);
  map.set(record.id, copy(record));
}

/** Écrit tout un tick. Les fermetures passent avant les ouvertures (comme la contrainte d'exclusion de la base). */
export function commitTick(db: Db, batch: TickBatch): void {
  const epoch = db.epochs.get(batch.epochId);
  if (!epoch) throw notFound(`Époque ${batch.epochId}`);

  for (const c of batch.scenesClosed) {
    const scene = db.scenes.get(c.id);
    if (!scene) throw notFound(`Scène ${c.id}`);
    db.scenes.set(c.id, { ...scene, tickEnd: c.tickEnd });
  }
  for (const c of batch.presencesClosed) {
    const presence = db.presences.get(c.id);
    if (!presence) throw notFound(`Présence ${c.id}`);
    db.presences.set(c.id, { ...presence, tickEnd: c.tickEnd });
  }

  for (const s of batch.scenesOpened) {
    require_(db.locations.has(s.locationId), `Lieu ${s.locationId}`);
    put(db.scenes, s, 'Scène');
  }
  for (const p of batch.presencesOpened) {
    require_(db.characters.has(p.characterId), `Personnage ${p.characterId}`);
    if (p.sceneId !== null) require_(db.scenes.has(p.sceneId), `Scène ${p.sceneId}`);
    for (const other of db.presences.values()) {
      if (other.epochId === p.epochId && other.characterId === p.characterId && overlaps(other, p)) {
        throw new DomainError(
          'PRESENCE_OVERLAP',
          `Présence en chevauchement (contrainte d'exclusion presence_no_overlap) : ${p.id} et ${other.id}`,
        );
      }
    }
    put(db.presences, p, 'Présence');
  }
  for (const i of batch.interactions) {
    require_(db.scenes.has(i.sceneId), `Scène ${i.sceneId}`);
    put(db.interactions, i, 'Interaction');
  }
  for (const u of batch.utterances) {
    require_(db.interactions.has(u.interactionId), `Interaction ${u.interactionId}`);
    put(db.utterances, u, 'Réplique');
  }
  for (const d of batch.decisions) {
    require_(db.characters.has(d.characterId), `Personnage ${d.characterId}`);
    put(db.decisions, d, 'Décision');
  }
  const seqs = new Set<number>();
  if (batch.events.length > 0) {
    for (const o of db.events.values()) if (db.epochs.get(o.epochId)?.worldId === epoch.worldId) seqs.add(o.seq);
  }
  for (const e of batch.events) {
    if (seqs.has(e.seq)) throw duplicate(`Event seq ${String(e.seq)}`);
    seqs.add(e.seq);
    put(db.events, e, 'Event');
  }
  for (const e of batch.effects) {
    require_(db.events.has(e.eventId), `Event ${e.eventId}`);
    require_(db.characters.has(e.characterId), `Personnage ${e.characterId}`);
    db.effects.push(copy(e));
  }
  for (const f of batch.facts) {
    if (db.facts.has(f.id)) throw duplicate(`Fait ${f.id}`);
    db.facts.set(f.id, { worldId: epoch.worldId, fact: copy(f) });
  }
  for (const k of batch.knowledge) insertKnowledge(db, k);
  for (const l of batch.ledger) {
    require_(db.characters.has(l.characterId), `Personnage ${l.characterId}`);
    put(db.ledger, l, 'Écriture de crédit');
  }
  for (const s of batch.scoreEntries) {
    require_(db.events.has(s.eventId), `Event ${s.eventId}`);
    put(db.scoreEntries, s, 'Entrée de score');
  }
  for (const r of batch.relationships) {
    require_(db.characters.has(r.sourceId), `Personnage ${r.sourceId}`);
    require_(db.characters.has(r.targetId), `Personnage ${r.targetId}`);
    checkEdge(r);
    db.relationships.set(`${r.sourceId}>${r.targetId}`, { worldId: epoch.worldId, edge: copy(r) });
  }
  for (const s of batch.characterStates) {
    require_(db.characters.has(s.characterId), `Personnage ${s.characterId}`);
    db.characterStates.set(`${s.characterId}|${s.epochId}`, copy(s));
  }

  for (const g of batch.goals) {
    require_(db.characters.has(g.characterId), `Personnage ${g.characterId}`);
    if (g.targetCharacterId !== null)
      require_(db.characters.has(g.targetCharacterId), `Personnage ${g.targetCharacterId}`);
    const existing = db.goals.get(g.id);
    db.goals.set(g.id, copy(existing ? { ...g, createdEpoch: existing.createdEpoch } : g));
  }

  db.epochs.set(epoch.id, { ...epoch, lastCommittedTick: batch.tick });
}

/** Les participants sont renvoyés triés (personnage, puis rôle) : l'ordre d'écriture n'est pas conservé. */
const byParticipant = (a: { characterId: string; role: string }, b: { characterId: string; role: string }): number =>
  cmp(a.characterId, b.characterId) || cmp(a.role, b.role);

export function readJournal(db: Db, epochId: string): EpochJournal {
  const interactions = [...db.interactions.values()].filter((i) => i.epochId === epochId);
  const interactionIds = new Set(interactions.map((i) => i.id));
  const events = [...db.events.values()].filter((e) => e.epochId === epochId).sort((a, b) => a.seq - b.seq);
  const seqOf = new Map(events.map((e) => [e.id, e.seq]));
  const effects: EffectRecord[] = db.effects
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.epochId === epochId)
    .sort((a, b) => (seqOf.get(a.e.eventId) ?? 0) - (seqOf.get(b.e.eventId) ?? 0) || a.index - b.index)
    .map(({ e }) => e);

  return copy({
    scenes: [...db.scenes.values()]
      .filter((s) => s.epochId === epochId)
      .sort((a, b) => a.tickStart - b.tickStart || cmp(a.id, b.id)),
    presences: [...db.presences.values()]
      .filter((p) => p.epochId === epochId)
      .sort((a, b) => cmp(a.characterId, b.characterId) || a.tickStart - b.tickStart || cmp(a.id, b.id)),
    interactions: interactions
      .map((i) => ({ ...i, participants: [...i.participants].sort(byParticipant) }))
      .sort((a, b) => a.tickStart - b.tickStart || cmp(a.id, b.id)),
    utterances: [...db.utterances.values()]
      .filter((u) => interactionIds.has(u.interactionId))
      .sort((a, b) => cmp(a.interactionId, b.interactionId) || a.seq - b.seq),
    decisions: [...db.decisions.values()]
      .filter((d) => d.epochId === epochId)
      .sort((a, b) => a.tick - b.tick || cmp(a.id, b.id)),
    events: events.map((e) => ({ ...e, participants: [...e.participants].sort(byParticipant) })),
    effects,
    ledger: [...db.ledger.values()].filter((l) => l.epochId === epochId).sort((a, b) => cmp(a.id, b.id)),
    scoreEntries: [...db.scoreEntries.values()].filter((s) => s.epochId === epochId).sort((a, b) => cmp(a.id, b.id)),
  });
}

export function insertKnowledge(db: Db, k: KnowledgeEdge): void {
  require_(db.characters.has(k.characterId), `Personnage ${k.characterId}`);
  require_(db.facts.has(k.factId), `Fait ${k.factId}`);
  if (k.toldById !== null) require_(db.characters.has(k.toldById), `Personnage ${k.toldById}`);
  if (k.viaEventId !== null) require_(db.events.has(k.viaEventId), `Event ${k.viaEventId}`);
  if (k.parentKnowledgeId !== null)
    require_(db.knowledge.has(k.parentKnowledgeId), `Connaissance ${k.parentKnowledgeId}`);
  const taken = [...db.knowledge.values()].some(
    (o) =>
      o.id === k.id ||
      (k.viaEventId !== null &&
        o.characterId === k.characterId &&
        o.factId === k.factId &&
        o.viaEventId === k.viaEventId),
  );
  if (taken) throw duplicate(`Connaissance ${k.id}`);
  db.knowledge.set(k.id, copy(k));
}
