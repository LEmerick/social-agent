/** Contrat de `EpisodeStore` : même suite sur l'adaptateur mémoire et l'adaptateur SQL. */
import { beforeEach, describe, expect, it } from 'vitest';
import { IDS, fixedId } from '@ai-reality/testkit';
import {
  type EpisodeRecord,
  type EpisodeStore,
  type NarrativeArc,
  episodeId,
  rowsOfScript,
  scriptOfRecord,
} from '../../src/index.js';
import { EPOCH_14, EVT } from './betrayal.js';
import { goodScript } from './script.js';

export const anArc = (over: Partial<NarrativeArc> = {}): NarrativeArc => ({
  id: fixedId(0x90, 1),
  worldId: IDS.world,
  title: 'alliance trahie',
  status: 'open',
  rootEventId: EVT.proposal,
  firstEpochId: EPOCH_14,
  lastEpochId: EPOCH_14,
  characterIds: [IDS.characters.alexandre, IDS.characters.sarah],
  eventIds: [EVT.proposal, EVT.betrayal],
  importance: 0.95,
  ...over,
});

export function anEpisode(version = 1, arcIds: string[] = [anArc().id]): EpisodeRecord {
  const id = episodeId(EPOCH_14, version);
  const script = goodScript();
  const rows = rowsOfScript(id, script);
  return {
    id,
    worldId: IDS.world,
    epochId: EPOCH_14,
    number: 14,
    version,
    title: script.title,
    synopsis: script.synopsis,
    status: 'draft',
    targetSeconds: 130,
    durationSeconds: 0,
    cliffhanger: script.cliffhanger,
    issues: [],
    arcIds,
    scenes: rows.scenes,
    lines: rows.lines,
  };
}

export function episodeStoreContract(
  name: string,
  factory: () => Promise<{ store: EpisodeStore; reset: () => Promise<void> }>,
): void {
  describe(`EpisodeStore (${name})`, () => {
    let store: EpisodeStore;
    beforeEach(async () => {
      const h = await factory();
      await h.reset();
      store = h.store;
    });

    it('enregistre un épisode avec ses scènes, ses lignes et ses arcs, et le relit à l’identique', async () => {
      await store.upsertArcs([anArc()]);
      const episode = anEpisode();
      await store.saveEpisode(episode);
      const [read] = await store.episodes(IDS.world);
      expect(read).toEqual(episode);
      expect(scriptOfRecord(episode)).toEqual(goodScript());
    });

    it('met à jour le statut, les problèmes et la durée', async () => {
      await store.upsertArcs([anArc()]);
      const episode = anEpisode();
      await store.saveEpisode(episode);
      const issue = {
        code: 'duration_exceeded' as const,
        message: 'trop long',
        sceneIndex: null,
        eventId: null,
        characterId: null,
      };
      await store.setStatus(episode.id, 'rejected', [issue], 125);
      expect((await store.episodes(IDS.world))[0]).toMatchObject({
        status: 'rejected',
        durationSeconds: 125,
        issues: [issue],
      });
      await expect(store.setStatus(fixedId(0x91, 1), 'validated', [], 0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuse deux fois la même version d’une époque, accepte une nouvelle version', async () => {
      await store.upsertArcs([anArc()]);
      await store.saveEpisode(anEpisode(1));
      await expect(store.saveEpisode(anEpisode(1))).rejects.toMatchObject({ code: 'DUPLICATE' });
      await store.saveEpisode(anEpisode(2));
      expect((await store.episodes(IDS.world)).map((e) => e.version)).toEqual([1, 2]);
    });

    it('une écriture échouée n’en laisse aucune trace', async () => {
      await store.upsertArcs([anArc()]);
      await store.saveEpisode(anEpisode(1));
      await expect(store.saveEpisode({ ...anEpisode(1), id: fixedId(0x92, 1) })).rejects.toBeDefined();
      expect(await store.episodes(IDS.world)).toHaveLength(1);
    });

    it('upsert des arcs : met à jour un arc existant, ne liste que les arcs ouverts du monde', async () => {
      await store.upsertArcs([anArc(), anArc({ id: fixedId(0x90, 2), title: 'autre', status: 'closed' })]);
      await store.upsertArcs([
        anArc({ eventIds: [EVT.proposal, EVT.rumor, EVT.betrayal], lastEpochId: fixedId(0, 15) }),
      ]);
      const open = await store.openArcs(IDS.world);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        eventIds: [EVT.proposal, EVT.rumor, EVT.betrayal],
        lastEpochId: fixedId(0, 15),
        firstEpochId: EPOCH_14,
      });
      expect(await store.openArcs(IDS.otherWorld)).toEqual([]);
    });
  });
}
