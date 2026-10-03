import { describe, expect, it } from 'vitest';
import { emptyTickBatch, type FormatState } from '@ai-reality/engine';
import { seedWorld } from '../builders.js';
import { FIDS, sampleFormatState } from '../fixtures/formats.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { EPOCH_0, jid, tick3Batch, tick4Batch } from './data.js';
import { type HarnessRef, expectCode } from './support.js';

/** Valeur attendue présente (sans assertion non nulle). */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Valeur attendue absente');
  return value;
}

const byId = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

/** Monde, époque 0 et événements des ticks 3 à 5 : de quoi satisfaire les clés étrangères des formats. */
async function withJournal(h: HarnessRef): Promise<FormatState> {
  await seedWorld(h().storage);
  await h().storage.tx((s) => s.epochs.insert(EPOCH_0));
  await h().storage.tx((s) => s.journal.commitTick(tick3Batch()));
  await h().storage.tx((s) => s.journal.commitTick(tick4Batch()));
  // Un troisième événement (décompte du conseil, déclenchement d'un événement planifié).
  await h().storage.tx((s) =>
    s.journal.commitTick({
      ...emptyTickBatch(EPOCH_0.id, 5),
      events: [
        {
          id: jid.event3,
          epochId: EPOCH_0.id,
          tick: 5,
          seq: 3,
          type: 'vote_tallied',
          sceneId: null,
          interactionId: null,
          locationId: null,
          payload: {},
          importance: 0.8,
          causedByEventId: null,
          participants: [],
        },
      ],
    }),
  );
  return sampleFormatState({ e1: jid.event1, e2: jid.event2, e3: jid.event3 }, jid.scene1);
}

/** Écrit un `FormatState` par les dépôts, dans l'ordre des dépendances. */
async function write(h: HarnessRef, fs: FormatState): Promise<void> {
  const S = IDS.season;
  await h().storage.tx(async (s) => {
    await s.items.upsertDefs(S, Object.values(fs.itemDefs));
    await s.missions.upsertDefs(S, Object.values(fs.missionDefs));
    await s.teams.upsertTeams(S, Object.values(fs.teams));
    await s.schedule.upsert(S, Object.values(fs.scheduled));
    await s.items.upsertItems(Object.values(fs.items));
    await s.missions.upsertAssignments(Object.values(fs.assignments));
    await s.teams.upsertMemberships(fs.memberships);
    await s.votes.upsertSessions(Object.values(fs.voteSessions));
    await s.votes.upsertVotes(fs.votes);
    await s.formatRuntime.save(S, { actionLog: fs.actionLog, presence: fs.presence });
  });
}

export function formatsContract(h: HarnessRef): void {
  describe('formats de jeu', () => {
    it('une saison sans format se relit vide', async () => {
      await seedWorld(h().storage);
      const S = IDS.season;
      const read = await h().storage.tx(async (s) => ({
        defs: await s.items.listDefs(S),
        items: await s.items.listItems(S),
        missions: await s.missions.listAssignments(S),
        teams: await s.teams.listTeams(S),
        sessions: await s.votes.listSessions(S),
        scheduled: await s.schedule.list(S),
        runtime: await s.formatRuntime.load(S),
      }));
      expect(read).toEqual({
        defs: [],
        items: [],
        missions: [],
        teams: [],
        sessions: [],
        scheduled: [],
        runtime: { actionLog: [], presence: {} },
      });
    });

    it('tout le FormatState se relit à l’identique, dans l’ordre annoncé', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const S = IDS.season;
      await h().storage.tx(async (s) => {
        expect(await s.items.listDefs(S)).toEqual(byId(Object.values(fs.itemDefs)));
        expect(await s.items.listItems(S)).toEqual(byId(Object.values(fs.items)));
        expect(await s.missions.listDefs(S)).toEqual(byId(Object.values(fs.missionDefs)));
        expect(await s.missions.listAssignments(S)).toEqual(byId(Object.values(fs.assignments)));
        expect(await s.teams.listTeams(S)).toEqual(byId(Object.values(fs.teams)));
        expect(await s.teams.listMemberships(S)).toEqual(
          [...fs.memberships].sort(
            (a, b) =>
              (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0) ||
              (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0) ||
              a.fromEpoch - b.fromEpoch,
          ),
        );
        expect(await s.votes.listSessions(S)).toEqual(byId(Object.values(fs.voteSessions)));
        expect(await s.votes.listVotes(S)).toEqual(
          [...fs.votes].sort((a, b) => (a.voterId < b.voterId ? -1 : a.voterId > b.voterId ? 1 : 0)),
        );
        expect(await s.schedule.list(S)).toEqual(byId(Object.values(fs.scheduled)));
        expect(await s.formatRuntime.load(S)).toEqual({ actionLog: fs.actionLog, presence: fs.presence });
      });
    });

    it('un upsert met à jour la ligne existante (objet déplacé, mission résolue, bulletin remplacé)', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const S = IDS.season;
      const moved = {
        ...(fs.items[FIDS.itemNecklace] as NonNullable<(typeof fs.items)[string]>),
        hidden: false,
        locationId: null,
        holderId: IDS.characters.sarah,
      };
      const resolved = {
        ...(fs.assignments[FIDS.assignThomas] as NonNullable<(typeof fs.assignments)[string]>),
        status: 'succeeded' as const,
        resolvedEventId: jid.event2,
      };
      const revote = {
        voteSessionId: FIDS.council,
        voterId: IDS.characters.sarah,
        targetId: IDS.characters.thomas,
        decisionId: null,
        revealed: true,
      };
      await h().storage.tx(async (s) => {
        await s.items.upsertItems([moved]);
        await s.missions.upsertAssignments([resolved]);
        await s.votes.upsertVotes([revote]);
      });
      await h().storage.tx(async (s) => {
        expect((await s.items.listItems(S)).find((i) => i.id === moved.id)).toEqual(moved);
        expect((await s.missions.listAssignments(S)).find((a) => a.id === resolved.id)).toEqual(resolved);
        const votes = await s.votes.listVotes(S);
        expect(votes).toHaveLength(3);
        expect(votes.find((v) => v.voterId === revote.voterId)).toEqual(revote);
      });
    });

    it('un objet ne peut avoir à la fois un porteur et un lieu', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const both = {
        ...(fs.items[FIDS.itemNecklace] as NonNullable<(typeof fs.items)[string]>),
        holderId: IDS.characters.sarah,
      };
      await expect(h().storage.tx((s) => s.items.upsertItems([both]))).rejects.toThrow();
    });

    it('un slug déjà pris par une autre définition est rejeté (DUPLICATE)', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const clash = {
        ...(fs.itemDefs[FIDS.defClue] as NonNullable<(typeof fs.itemDefs)[string]>),
        id: fixedId(0x80, 9),
        slug: 'immunity_necklace',
      };
      await expectCode(
        h().storage.tx((s) => s.items.upsertDefs(IDS.season, [clash])),
        'DUPLICATE',
      );
      const team = { ...(fs.teams[FIDS.teamRed] as NonNullable<(typeof fs.teams)[string]>), id: fixedId(0x84, 9) };
      await expectCode(
        h().storage.tx((s) => s.teams.upsertTeams(IDS.season, [team])),
        'DUPLICATE',
      );
    });

    it('les références inconnues sont rejetées (NOT_FOUND)', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const S = IDS.season;
      const ghostSeason = fixedId(0, 99);
      await expectCode(
        h().storage.tx((s) => s.items.upsertDefs(ghostSeason, Object.values(fs.itemDefs))),
        'NOT_FOUND',
      );
      const item = fs.items[FIDS.itemNecklace] as NonNullable<(typeof fs.items)[string]>;
      await expectCode(
        h().storage.tx((s) => s.items.upsertItems([{ ...item, locationId: fixedId(0x10, 99) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.items.upsertItems([{ ...item, itemDefId: fixedId(0x80, 99) }])),
        'NOT_FOUND',
      );
      const assignment = fs.assignments[FIDS.assignThomas] as NonNullable<(typeof fs.assignments)[string]>;
      await expectCode(
        h().storage.tx((s) => s.missions.upsertAssignments([{ ...assignment, assignedEventId: fixedId(0x76, 99) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.missions.upsertAssignments([{ ...assignment, characterId: fixedId(0x30, 99) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.teams.upsertMemberships([{ ...must(fs.memberships[0]), teamId: fixedId(0x84, 99) }])),
        'NOT_FOUND',
      );
      const session = fs.voteSessions[FIDS.council] as NonNullable<(typeof fs.voteSessions)[string]>;
      await expectCode(
        h().storage.tx((s) => s.votes.upsertSessions([{ ...session, epochId: fixedId(0, 98) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.votes.upsertVotes([{ ...must(fs.votes[0]), voteSessionId: fixedId(0x85, 99) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.formatRuntime.save(ghostSeason, { actionLog: [], presence: {} })),
        'NOT_FOUND',
      );
      // Rien n'a été écrit de travers : l'état d'origine est intact.
      expect(await h().storage.tx((s) => s.items.listItems(S))).toEqual(byId(Object.values(fs.items)));
    });

    it('un événement ne peut servir qu’à une session de vote et qu’à un événement planifié', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const other = {
        ...(fs.voteSessions[FIDS.council] as NonNullable<(typeof fs.voteSessions)[string]>),
        id: fixedId(0x85, 2),
        result: null,
      };
      await expectCode(
        h().storage.tx((s) => s.votes.upsertSessions([other])),
        'DUPLICATE',
      );
      const sched = {
        ...(fs.scheduled[FIDS.scheduledMerge] as NonNullable<(typeof fs.scheduled)[string]>),
        firedEventId: jid.event3,
      };
      await expectCode(
        h().storage.tx((s) => s.schedule.upsert(IDS.season, [sched])),
        'DUPLICATE',
      );
    });

    it('une mission doit avoir exactement un titulaire (personnage ou équipe)', async () => {
      const fs = await withJournal(h);
      await write(h, fs);
      const a = fs.assignments[FIDS.assignThomas] as NonNullable<(typeof fs.assignments)[string]>;
      await expect(
        h().storage.tx((s) => s.missions.upsertAssignments([{ ...a, teamId: FIDS.teamRed }])),
      ).rejects.toThrow();
      await expect(
        h().storage.tx((s) => s.missions.upsertAssignments([{ ...a, characterId: null }])),
      ).rejects.toThrow();
    });
  });
}
