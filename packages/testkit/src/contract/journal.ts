import { describe, expect, it } from 'vitest';
import { defaultEdge, emptyTickBatch } from '@ai-reality/engine';
import { seedWorld } from '../builders.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { EPOCH_0, EPOCH_1, SARAH_SECRET, jid, tick3Batch, tick4Batch } from './data.js';
import { type HarnessRef, expectCode } from './support.js';

const C = IDS.characters;

/** Monde Palmiers + époque 0 prête à recevoir des ticks. */
async function withEpoch(h: HarnessRef): Promise<void> {
  await seedWorld(h().storage);
  await h().storage.tx((s) => s.epochs.insert(EPOCH_0));
}

export function journalContract(h: HarnessRef): void {
  describe('époques', () => {
    it('une époque se relit par id et par numéro ; numéro en double ⇒ DUPLICATE', async () => {
      await withEpoch(h);
      expect(await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id))).toEqual(EPOCH_0);
      expect(await h().storage.tx((s) => s.epochs.findByNumber(IDS.world, 0))).toEqual(EPOCH_0);
      expect(await h().storage.tx((s) => s.epochs.findByNumber(IDS.world, 7))).toBeUndefined();
      await expectCode(
        h().storage.tx((s) => s.epochs.insert({ ...EPOCH_0, id: fixedId(0, 50) })),
        'DUPLICATE',
      );
    });

    it('une époque d’une saison ou d’un monde inconnus est rejetée (NOT_FOUND)', async () => {
      await seedWorld(h().storage);
      await expectCode(
        h().storage.tx((s) => s.epochs.insert({ ...EPOCH_1, seasonId: fixedId(0, 77) })),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.epochs.insert({ ...EPOCH_1, worldId: IDS.otherWorld })),
        'NOT_FOUND',
      );
    });

    it('setStatus change le statut ; époque inconnue ⇒ NOT_FOUND', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.epochs.setStatus(EPOCH_0.id, 'completed'));
      expect((await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id)))?.status).toBe('completed');
      await expectCode(
        h().storage.tx((s) => s.epochs.setStatus(fixedId(0, 78), 'failed')),
        'NOT_FOUND',
      );
    });
  });

  describe('journal : commitTick', () => {
    it('écrit tout le lot puis le relit à l’identique, dans l’ordre annoncé', async () => {
      await withEpoch(h);
      const batch = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(batch));

      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(journal.scenes).toEqual(batch.scenesOpened);
      expect(journal.presences).toEqual(batch.presencesOpened);
      expect(journal.interactions).toEqual(batch.interactions);
      expect(journal.utterances).toEqual(batch.utterances);
      expect(journal.decisions).toEqual(batch.decisions);
      expect(journal.events).toEqual(batch.events);
      expect(journal.effects).toEqual(batch.effects); // ordre d'insertion conservé pour un même event
      expect(journal.ledger).toEqual(batch.ledger);
      expect(journal.scoreEntries).toEqual(batch.scoreEntries);
    });

    it('positionne lastCommittedTick et écrit projections, faits et connaissances', async () => {
      await withEpoch(h);
      const batch = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(batch));

      expect((await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id)))?.lastCommittedTick).toBe(3);
      const read = await h().storage.tx(async (s) => ({
        relationships: await s.relationships.listByWorld(IDS.world),
        facts: await s.facts.listByWorld(IDS.world),
        knowledge: await s.knowledge.listByWorld(IDS.world),
        states: await s.characterStates.listByEpoch(EPOCH_0.id),
      }));
      for (const edge of batch.relationships) expect(read.relationships).toContainEqual(edge);
      expect(read.facts).toEqual(expect.arrayContaining([...batch.facts, SARAH_SECRET]));
      expect(read.knowledge).toEqual(expect.arrayContaining([...batch.knowledge]));
      expect(read.states).toEqual(batch.characterStates);
    });

    it('les fermetures de scène et de présence mettent à jour tickEnd ; une présence peut être rouverte au même tick', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.journal.commitTick(tick3Batch()));
      await h().storage.tx((s) => s.journal.commitTick(tick4Batch()));

      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(journal.scenes.map((x) => [x.id, x.tickEnd])).toEqual([
        [jid.scene1, 4],
        [jid.scene2, null],
      ]);
      const alexandre = journal.presences.filter((p) => p.characterId === C.alexandre);
      expect(alexandre.map((p) => [p.id, p.tickStart, p.tickEnd])).toEqual([
        [jid.presAlexandre, 3, 4],
        [jid.presAlexandre2, 4, null],
      ]);
      expect((await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id)))?.lastCommittedTick).toBe(4);
    });

    it('characterStates et relationships : l’upsert est idempotent et la dernière valeur l’emporte', async () => {
      await withEpoch(h);
      const first = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(first));

      const state = first.characterStates[0];
      const edge = first.relationships[0];
      if (!state || !edge) throw new Error('lot incomplet');
      const next = {
        ...emptyTickBatch(EPOCH_0.id, 4),
        characterStates: [{ ...state, credits: 80, mood: { hope: 10, anger: 20 }, runtime: { agenda: [] } }],
        relationships: [{ ...edge, alliance: 40, labels: [] }],
      };
      await h().storage.tx((s) => s.journal.commitTick(next));
      await h().storage.tx((s) => s.journal.commitTick({ ...next, tick: 5 }));

      const states = await h().storage.tx((s) => s.characterStates.listByEpoch(EPOCH_0.id));
      expect(states).toEqual(next.characterStates);
      const edges = await h().storage.tx((s) => s.relationships.listByWorld(IDS.world));
      expect(edges.filter((r) => r.sourceId === C.alexandre && r.targetId === C.sarah)).toEqual(next.relationships);
    });

    it('commitTick : goals insère les nouveaux objectifs et met à jour les existants (relus par listByWorld)', async () => {
      await withEpoch(h);
      const existing = (await h().storage.tx((s) => s.goals.listByWorld(IDS.world)))[0];
      if (!existing) throw new Error('fixture sans objectif');
      const created = {
        ...existing,
        id: fixedId(0x40, 80),
        description: 'objectif de réflexion',
        status: 'open' as const,
        createdEpoch: 0,
        closedEpoch: null,
      };
      await h().storage.tx((s) => s.journal.commitTick({ ...emptyTickBatch(EPOCH_0.id, 3), goals: [created] }));
      await h().storage.tx((s) =>
        s.journal.commitTick({
          ...emptyTickBatch(EPOCH_0.id, 4),
          goals: [{ ...existing, status: 'abandoned', createdEpoch: null, closedEpoch: 0 }],
        }),
      );
      const goals = await h().storage.tx((s) => s.goals.listByWorld(IDS.world));
      expect(goals.find((g) => g.id === created.id)).toEqual(created);
      expect(goals.find((g) => g.id === existing.id)).toEqual({
        ...existing,
        status: 'abandoned',
        closedEpoch: 0,
      });
    });

    it('reweighScoreEntries remplace les poids sans toucher aux impacts ; updateScores fusionne les scores', async () => {
      await withEpoch(h);
      const batch = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(batch));
      const weights = { social: 2, drama: 3, popularity: 4, survival: 5, influence: 6 };

      await h().storage.tx((s) => s.journal.reweighScoreEntries(EPOCH_0.id, weights));
      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(batch.scoreEntries.length).toBeGreaterThan(0);
      expect(journal.scoreEntries).toEqual(batch.scoreEntries.map((e) => ({ ...e, weight: weights[e.score] })));

      const state = batch.characterStates[0];
      if (!state) throw new Error('lot incomplet');
      await h().storage.tx((s) =>
        s.characterStates.updateScores(EPOCH_0.id, { [state.characterId]: { social: 12.5 } }),
      );
      const rows = await h().storage.tx((s) => s.characterStates.listByEpoch(EPOCH_0.id));
      expect(rows.find((r) => r.characterId === state.characterId)?.scores).toEqual({ ...state.scores, social: 12.5 });
      expect(rows.filter((r) => r.characterId !== state.characterId)).toEqual(
        batch.characterStates.filter((r) => r.characterId !== state.characterId),
      );
      await expectCode(
        h().storage.tx((s) => s.journal.reweighScoreEntries(fixedId(0, 79), weights)),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.characterStates.updateScores(fixedId(0, 79), { [state.characterId]: { social: 1 } })),
        'NOT_FOUND',
      );
    });

    it('un lot vide avance seulement lastCommittedTick', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.journal.commitTick(emptyTickBatch(EPOCH_0.id, 0)));
      expect((await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id)))?.lastCommittedTick).toBe(0);
      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(journal.events).toEqual([]);
    });

    it('rollback : une exception après commitTick annule le lot entier', async () => {
      await withEpoch(h);
      await expect(
        h().storage.tx(async (s) => {
          await s.journal.commitTick(tick3Batch());
          throw new Error('crash au milieu du tick');
        }),
      ).rejects.toThrow('crash');
      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(journal.scenes).toEqual([]);
      expect(journal.events).toEqual([]);
      expect(await h().storage.tx((s) => s.relationships.listByWorld(IDS.world))).not.toContainEqual(
        expect.objectContaining({ alliance: 15 }),
      );
      expect((await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id)))?.lastCommittedTick).toBe(-1);
    });

    it('un lot invalide (event en double) annule tout le lot', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.journal.commitTick(tick3Batch()));
      const replay = {
        ...emptyTickBatch(EPOCH_0.id, 9),
        scenesOpened: tick4Batch().scenesOpened,
        events: tick3Batch().events.slice(0, 1),
      };
      await expectCode(
        h().storage.tx((s) => s.journal.commitTick(replay)),
        'DUPLICATE',
      );
      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(journal.scenes).toHaveLength(1);
      expect((await h().storage.tx((s) => s.epochs.findById(EPOCH_0.id)))?.lastCommittedTick).toBe(3);
    });

    it('un seq d’event déjà pris dans le monde est rejeté (DUPLICATE) ; le même seq est permis dans un autre monde', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.journal.commitTick(tick3Batch()));
      const [e] = tick3Batch().events;
      if (!e) throw new Error('lot sans event');
      const clash = {
        ...emptyTickBatch(EPOCH_0.id, 5),
        events: [{ ...e, id: fixedId(0x76, 90), causedByEventId: null }],
      };
      await expectCode(
        h().storage.tx((s) => s.journal.commitTick(clash)),
        'DUPLICATE',
      );
    });

    it('une époque inconnue est rejetée (NOT_FOUND)', async () => {
      await seedWorld(h().storage);
      await expectCode(
        h().storage.tx((s) => s.journal.commitTick(emptyTickBatch(fixedId(0, 79), 0))),
        'NOT_FOUND',
      );
    });

    it('un rattachement inconnu dans le lot (lieu, personnage) est rejeté (NOT_FOUND)', async () => {
      await withEpoch(h);
      const batch = tick3Batch();
      const [scene] = batch.scenesOpened;
      if (!scene) throw new Error('lot sans scène');
      await expectCode(
        h().storage.tx((s) =>
          s.journal.commitTick({
            ...emptyTickBatch(EPOCH_0.id, 3),
            scenesOpened: [{ ...scene, locationId: fixedId(0x10, 99) }],
          }),
        ),
        'NOT_FOUND',
      );
    });
  });

  describe('journal : lectures', () => {
    it('eventsOfWorld renvoie les events de toutes les époques triés par seq', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.epochs.insert(EPOCH_1));
      const batch = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(batch));
      const [first] = batch.events;
      if (!first) throw new Error('lot sans event');
      const later = {
        ...emptyTickBatch(EPOCH_1.id, 0),
        events: [
          {
            ...first,
            id: fixedId(0x76, 3),
            epochId: EPOCH_1.id,
            tick: 0,
            seq: 3,
            causedByEventId: null,
            sceneId: null,
            locationId: null,
          },
        ],
      };
      await h().storage.tx((s) => s.journal.commitTick(later));
      const events = await h().storage.tx((s) => s.journal.eventsOfWorld(IDS.world));
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(events).toEqual([...batch.events, ...later.events]);
      expect((await h().storage.tx((s) => s.journal.read(EPOCH_1.id))).events).toEqual(later.events);
    });

    it('un second segment de présence qui chevauche le premier ⇒ PRESENCE_OVERLAP, et le lot est annulé', async () => {
      await withEpoch(h);
      const batch = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(batch));
      const [open] = batch.presencesOpened;
      if (!open) throw new Error('lot sans présence');
      const overlapping = {
        ...emptyTickBatch(EPOCH_0.id, 5),
        presencesOpened: [
          { ...open, id: fixedId(0x72, 40), tickStart: 5, tickEnd: null, kind: 'offstage' as const, sceneId: null },
        ],
      };
      await expectCode(
        h().storage.tx((s) => s.journal.commitTick(overlapping)),
        'PRESENCE_OVERLAP',
      );
      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(journal.presences).toEqual(batch.presencesOpened);
    });

    it('un segment fermé puis un contigu dans le même lot est accepté (fermetures avant ouvertures)', async () => {
      await withEpoch(h);
      const batch = tick3Batch();
      await h().storage.tx((s) => s.journal.commitTick(batch));
      const [open] = batch.presencesOpened;
      if (!open) throw new Error('lot sans présence');
      const next = {
        ...emptyTickBatch(EPOCH_0.id, 5),
        presencesClosed: [{ id: open.id, tickEnd: 5 }],
        presencesOpened: [
          { ...open, id: fixedId(0x72, 41), tickStart: 5, tickEnd: null, kind: 'offstage' as const, sceneId: null },
        ],
      };
      await h().storage.tx((s) => s.journal.commitTick(next));
    });

    it('une relation hors bornes ou d’un personnage avec lui-même ⇒ CONSTRAINT_VIOLATION', async () => {
      await withEpoch(h);
      const before = await h().storage.tx((s) => s.relationships.listByWorld(IDS.world));
      await expectCode(
        h().storage.tx((s) =>
          s.relationships.upsert(IDS.world, [{ ...defaultEdge(C.sarah, C.alexandre), trust: 120 }]),
        ),
        'CONSTRAINT_VIOLATION',
      );
      await expectCode(
        h().storage.tx((s) => s.relationships.upsert(IDS.world, [defaultEdge(C.sarah, C.sarah)])),
        'CONSTRAINT_VIOLATION',
      );
      expect(await h().storage.tx((s) => s.relationships.listByWorld(IDS.world))).toEqual(before);
    });

    it('maxSeq renvoie le plus grand seq du monde, 0 sans event', async () => {
      await withEpoch(h);
      expect(await h().storage.tx((s) => s.journal.maxSeq(IDS.world))).toBe(0);
      await h().storage.tx((s) => s.epochs.insert(EPOCH_1));
      await h().storage.tx((s) => s.journal.commitTick(tick3Batch()));
      expect(await h().storage.tx((s) => s.journal.maxSeq(IDS.world))).toBe(2);
    });

    it('read d’une époque sans journal renvoie des listes vides', async () => {
      await withEpoch(h);
      const journal = await h().storage.tx((s) => s.journal.read(EPOCH_0.id));
      expect(Object.values(journal).every((list: unknown[]) => list.length === 0)).toBe(true);
    });

    it('characterStates.latest renvoie la ligne de l’époque la plus récente de chaque personnage', async () => {
      await withEpoch(h);
      await h().storage.tx((s) => s.epochs.insert(EPOCH_1));
      const state = tick3Batch().characterStates[0];
      if (!state) throw new Error('lot sans état');
      const base = { stats: state.stats, status: state.status, mood: {}, scores: {}, runtime: {} };
      await h().storage.tx(async (s) => {
        await s.journal.commitTick({
          ...emptyTickBatch(EPOCH_1.id, 0),
          characterStates: [{ ...base, characterId: C.alexandre, epochId: EPOCH_1.id, credits: 70 }],
        });
        await s.journal.commitTick({
          ...emptyTickBatch(EPOCH_0.id, 3),
          characterStates: [
            { ...base, characterId: C.alexandre, epochId: EPOCH_0.id, credits: 90 },
            { ...base, characterId: C.sarah, epochId: EPOCH_0.id, credits: 100 },
          ],
        });
      });
      const latest = await h().storage.tx((s) => s.characterStates.latest(IDS.world));
      expect(latest.map((l) => [l.characterId, l.epochId, l.credits])).toEqual([
        [C.alexandre, EPOCH_1.id, 70],
        [C.sarah, EPOCH_0.id, 100],
      ]);
    });

    it('les instantanés de relations se relisent triés ; une nouvelle sauvegarde remplace la précédente', async () => {
      await withEpoch(h);
      const a = defaultEdge(C.sarah, C.lea);
      const b = { ...defaultEdge(C.alexandre, C.sarah), trust: 55, extraAxes: { loyaute: 3 } };
      await h().storage.tx((s) => s.snapshots.saveRelationships(EPOCH_0.id, [a, b]));
      const first = await h().storage.tx((s) => s.snapshots.relationships(EPOCH_0.id));
      expect(first.map((r) => [r.sourceId, r.targetId])).toEqual([
        [C.alexandre, C.sarah],
        [C.sarah, C.lea],
      ]);
      expect(first[0]?.trust).toBe(55);
      await h().storage.tx((s) => s.snapshots.saveRelationships(EPOCH_0.id, [a]));
      expect(await h().storage.tx((s) => s.snapshots.relationships(EPOCH_0.id))).toHaveLength(1);
      await expectCode(
        h().storage.tx((s) => s.snapshots.saveRelationships(fixedId(0, 80), [a])),
        'NOT_FOUND',
      );
    });
  });
}
