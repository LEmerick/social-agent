import type { KnowledgeEdge, StorageTx } from '@ai-reality/engine';
import { type Db, cmp, copy, duplicate, later, notFound, require_ } from './db.js';
import { commitTick, insertKnowledge, readJournal } from './journal.js';

type SimRepos = Pick<
  StorageTx,
  'relationships' | 'facts' | 'knowledge' | 'epochs' | 'journal' | 'characterStates' | 'snapshots'
>;

/** Projections, connaissances, époques et journal. */
export function simRepos(db: Db): SimRepos {
  const worldOfCharacter = (characterId: string): string | undefined => db.characters.get(characterId)?.worldId;

  return {
    relationships: {
      upsert: (worldId, edges) =>
        later(() => {
          require_(db.worlds.has(worldId), `Monde ${worldId}`);
          for (const e of edges) {
            require_(db.characters.has(e.sourceId), `Personnage ${e.sourceId}`);
            require_(db.characters.has(e.targetId), `Personnage ${e.targetId}`);
            db.relationships.set(`${e.sourceId}>${e.targetId}`, { worldId, edge: copy(e) });
          }
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.relationships.values()]
            .filter((r) => r.worldId === worldId)
            .map((r) => copy(r.edge))
            .sort((a, b) => cmp(a.sourceId, b.sourceId) || cmp(a.targetId, b.targetId)),
        ),
    },

    facts: {
      insert: (worldId, facts) =>
        later(() => {
          require_(db.worlds.has(worldId), `Monde ${worldId}`);
          for (const fact of facts) {
            if (db.facts.has(fact.id)) throw duplicate(`Fait ${fact.id}`);
            db.facts.set(fact.id, { worldId, fact: copy(fact) });
          }
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.facts.values()]
            .filter((f) => f.worldId === worldId)
            .map((f) => copy(f.fact))
            .sort((a, b) => cmp(a.id, b.id)),
        ),
    },

    knowledge: {
      insert: (edges) =>
        later(() => {
          for (const k of edges) insertKnowledge(db, k);
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.knowledge.values()]
            .filter((k) => worldOfCharacter(k.characterId) === worldId)
            .sort((a, b) => cmp(a.characterId, b.characterId) || cmp(a.id, b.id))
            .map(copy),
        ),
      provenance: (characterId, factId) =>
        later(() => {
          // Point de départ : la plus ancienne connaissance du fait par ce personnage.
          const start = [...db.knowledge.values()]
            .filter((k) => k.characterId === characterId && k.factId === factId)
            .sort((a, b) => a.learnedEpoch - b.learnedEpoch || a.learnedTick - b.learnedTick || cmp(a.id, b.id))[0];
          const chain: KnowledgeEdge[] = [];
          const seen = new Set<string>();
          for (
            let k = start;
            k && !seen.has(k.id);
            k = k.parentKnowledgeId ? db.knowledge.get(k.parentKnowledgeId) : undefined
          ) {
            seen.add(k.id);
            chain.push(copy(k));
          }
          return chain.reverse();
        }),
    },

    epochs: {
      insert: (epoch) =>
        later(() => {
          require_(db.worlds.has(epoch.worldId), `Monde ${epoch.worldId}`);
          require_(db.seasons.has(epoch.seasonId), `Saison ${epoch.seasonId}`);
          const taken = [...db.epochs.values()].some(
            (e) => e.id === epoch.id || (e.worldId === epoch.worldId && e.number === epoch.number),
          );
          if (taken) throw duplicate(`Époque ${String(epoch.number)}`);
          db.epochs.set(epoch.id, copy(epoch));
        }),
      findByNumber: (worldId, number) =>
        later(() => copy([...db.epochs.values()].find((e) => e.worldId === worldId && e.number === number))),
      findById: (id) => later(() => copy(db.epochs.get(id))),
      setStatus: (id, status) =>
        later(() => {
          const epoch = db.epochs.get(id);
          if (!epoch) throw notFound(`Époque ${id}`);
          db.epochs.set(id, { ...epoch, status });
        }),
    },

    journal: {
      commitTick: (batch) =>
        later(() => {
          commitTick(db, batch);
        }),
      read: (epochId) => later(() => readJournal(db, epochId)),
      eventsOfWorld: (worldId) =>
        later(() =>
          [...db.events.values()]
            .filter((e) => db.epochs.get(e.epochId)?.worldId === worldId)
            .sort((a, b) => a.seq - b.seq)
            .map(copy),
        ),
      reweighScoreEntries: (epochId, weights) =>
        later(() => {
          require_(db.epochs.has(epochId), `Époque ${epochId}`);
          for (const [id, entry] of db.scoreEntries) {
            if (entry.epochId === epochId) db.scoreEntries.set(id, { ...entry, weight: weights[entry.score] });
          }
        }),
    },

    characterStates: {
      latest: (worldId) =>
        later(() => {
          const best = new Map<string, { number: number; row: (typeof rows)[number] }>();
          const rows = [...db.characterStates.values()];
          for (const row of rows) {
            if (worldOfCharacter(row.characterId) !== worldId) continue;
            const number = db.epochs.get(row.epochId)?.number ?? -1;
            const current = best.get(row.characterId);
            if (!current || number > current.number) best.set(row.characterId, { number, row });
          }
          return [...best.values()].map((b) => copy(b.row)).sort((a, b) => cmp(a.characterId, b.characterId));
        }),
      listByEpoch: (epochId) =>
        later(() =>
          [...db.characterStates.values()]
            .filter((s) => s.epochId === epochId)
            .sort((a, b) => cmp(a.characterId, b.characterId))
            .map(copy),
        ),
      updateScores: (epochId, scores) =>
        later(() => {
          for (const [characterId, values] of Object.entries(scores)) {
            const key = `${characterId}|${epochId}`;
            const row = db.characterStates.get(key);
            if (!row) throw notFound(`État du personnage ${characterId} à l'époque ${epochId}`);
            db.characterStates.set(key, { ...row, scores: { ...row.scores, ...values } });
          }
        }),
    },

    snapshots: {
      saveRelationships: (epochId, edges) =>
        later(() => {
          require_(db.epochs.has(epochId), `Époque ${epochId}`);
          db.snapshots.set(epochId, copy([...edges]));
        }),
      relationships: (epochId) =>
        later(() =>
          copy(db.snapshots.get(epochId) ?? []).sort(
            (a, b) => cmp(a.sourceId, b.sourceId) || cmp(a.targetId, b.targetId),
          ),
        ),
    },
  };
}
