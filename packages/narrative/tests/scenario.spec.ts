import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { FakeLLM, IDS } from '@ai-reality/testkit';
import {
  type EpisodeScript,
  createConfessionalService,
  createNarrativeEngine,
  createWriterAgent,
  memoryNarrativeStorage,
  sceneSheetsOf,
  storageContextProvider,
} from '../src/index.js';
import { C, EPOCH_14, EVT, L, seedBetrayal } from './helpers/betrayal.js';
import { goodScript, withScene } from './helpers/script.js';

const CONFESSIONS: Record<string, string> = {
  [C.alexandre]: 'Je joue ma partie, et je la joue seul.',
  [C.sarah]: 'Je ne sais pas s’il est sincère…',
};
const OPTIONS = { targetSeconds: 130, minScreenTimePerPlayer: 10 };

function scriptWithConfessional(): EpisodeScript {
  const script = goodScript();
  const [first, ...rest] = script.scenes;
  if (!first) throw new Error('scène absente');
  const confessional = {
    kind: 'confessional' as const,
    speakerId: C.alexandre,
    text: CONFESSIONS[C.alexandre] ?? '',
    utteranceId: null,
    tone: null,
  };
  return { ...script, scenes: [{ ...first, lines: [...first.lines, confessional] }, ...rest] };
}

async function setup(writerReplies: readonly (EpisodeScript | Error)[]) {
  const sim = createMemoryStorage();
  await seedBetrayal(sim);
  const storage = memoryNarrativeStorage(sim);
  const llm = new FakeLLM({
    rules: [
      {
        purpose: 'interview',
        replies: [(req) => ({ answer: CONFESSIONS[req.characterId ?? ''] ?? 'Sans commentaire.', reveals: [] })],
      },
      { purpose: 'write', replies: writerReplies },
    ],
  });
  const engine = createNarrativeEngine({
    storage,
    writer: createWriterAgent({ llm }),
    confessional: createConfessionalService({
      runtime: createAgentRuntime({ llm, persona: (id) => `Persona ${id}` }),
      contextFor: storageContextProvider(sim),
    }),
    options: OPTIONS,
  });
  return { sim, storage, llm, engine };
}

describe('épisode 14 « l’alliance trahie » (journal écrit à la main, WriterAgent FakeLLM)', () => {
  it('produit 4 scènes valides, avec sources, confessionnal enregistré, et persiste tout', async () => {
    const { storage, llm, engine } = await setup([scriptWithConfessional()]);

    const episode = await engine.produce(EPOCH_14);

    expect(episode.status).toBe('validated');
    expect(episode.issues).toEqual([]);
    expect(episode.number).toBe(14);
    expect(episode.script.scenes).toHaveLength(4);
    for (const scene of episode.script.scenes) expect(scene.sources.length).toBeGreaterThan(0);
    expect(episode.script.scenes.flatMap((s) => s.sources)).toEqual([
      EVT.proposal,
      EVT.confidence,
      EVT.rumor,
      EVT.betrayal,
    ]);
    expect(episode.durationSeconds).toBe(125);

    // Un confessionnal par arc, enregistré avec le contexte de son personnage seulement.
    expect(episode.confessionals.map((c) => c.speakerId).sort()).toEqual([C.alexandre, C.sarah].sort());
    expect(llm.requestsFor('interview')).toHaveLength(2);
    const alexandreLine = episode.lines.find((l) => l.kind === 'confessional');
    expect(alexandreLine?.llmCallId).toBe(episode.confessionals.find((c) => c.speakerId === C.alexandre)?.llmCallId);

    // Le prompt du scénariste contient les sources, les répliques, les effets et les confessionnaux.
    const prompt = llm.requestsFor('write')[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain(EVT.betrayal);
    expect(prompt).toContain('Sarah, on devrait faire équipe');
    expect(prompt).toContain('alliance -40');
    expect(prompt).toContain(CONFESSIONS[C.alexandre] ?? '');

    // Persistance : épisode, scènes, lignes, arcs.
    const [stored] = await storage.episodes.episodes(IDS.world);
    expect(stored).toMatchObject({ status: 'validated', version: 1, durationSeconds: 125 });
    expect(stored?.scenes).toHaveLength(4);
    expect(stored?.arcIds).toEqual(episode.arcs.map((a) => a.id).sort());
    expect((await storage.episodes.openArcs(IDS.world)).map((a) => a.rootEventId)).toContain(EVT.proposal);
  });

  it('réécrit avec les problèmes du validateur quand le premier script est rejeté', async () => {
    const bad = withScene(0, { sources: ['01960000-0000-7000-8000-00000000dead'] });
    const { llm, engine } = await setup([bad, goodScript()]);

    const episode = await engine.produce(EPOCH_14);

    expect(llm.requestsFor('write')).toHaveLength(2);
    expect(llm.requestsFor('write')[1]?.messages[0]?.content).toContain('Source inexistante dans le journal');
    expect(episode.status).toBe('validated');
  });

  it('enregistre un épisode rejeté avec ses problèmes, puis en accepte une nouvelle version', async () => {
    const bad = withScene(0, { characterIds: [C.alexandre, C.sarah, C.thomas] });
    const { storage, engine } = await setup([bad, bad, goodScript()]);

    const rejected = await engine.produce(EPOCH_14);
    expect(rejected.status).toBe('rejected');
    expect(rejected.issues.map((i) => i.code)).toEqual(['character_absent']);
    expect((await storage.episodes.episodes(IDS.world))[0]).toMatchObject({
      status: 'rejected',
      issues: rejected.issues,
    });

    const fixed = await engine.produce(EPOCH_14);
    expect(fixed).toMatchObject({ status: 'validated', version: 2 });
    await expect(engine.produce(EPOCH_14)).rejects.toMatchObject({ code: 'EPISODE_EXISTS' });
  });

  it('exporte les fiches Scene pour le Video Engine', async () => {
    const { sim, engine } = await setup([scriptWithConfessional()]);
    const episode = await engine.produce(EPOCH_14);
    const [characters, locations] = await sim.tx(
      async (s) => [await s.characters.listByWorld(IDS.world), await s.locations.listByWorld(IDS.world)] as const,
    );

    const sheets = sceneSheetsOf(episode, {
      characters,
      locations,
      visuals: { [C.sarah]: { version: 'v2', description: 'robe blanche' } },
    });

    expect(sheets).toHaveLength(4);
    expect(sheets[0]).toMatchObject({
      number: 1,
      location: { id: L.jardin, name: expect.any(String) },
      tone: 'tendu',
      sources: [EVT.proposal],
    });
    expect(sheets[0]?.characters.map((c) => [c.name, c.visual?.version ?? null])).toEqual([
      ['Alexandre', null],
      ['Sarah', 'v2'],
    ]);
    expect(sheets[0]?.dialogues.map((d) => [d.kind, d.speakerName])).toEqual([
      ['dialogue', 'Alexandre'],
      ['dialogue', 'Sarah'],
      ['voiceover', null],
      ['confessional', 'Alexandre'],
    ]);
    expect(sheets[0]?.shots[0]?.description).toContain('Alexandre');
  });

  it('refuse une époque non terminée', async () => {
    const sim = createMemoryStorage();
    await seedBetrayal(sim, 'running');
    const engine = createNarrativeEngine({
      storage: memoryNarrativeStorage(sim),
      writer: createWriterAgent({ llm: new FakeLLM() }),
      options: OPTIONS,
    });
    await expect(engine.produce(EPOCH_14)).rejects.toMatchObject({ code: 'EPOCH_NOT_COMPLETED' });
  });
});
