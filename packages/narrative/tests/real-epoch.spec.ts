import { describe, expect, it } from 'vitest';
import { HeuristicOutcomeModel, createEpochScheduler, economyHook, interactionHook } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { FakeLLM, IDS, UniformRandomPolicy, aWorld, seedWorld } from '@ai-reality/testkit';
import {
  type EpisodeScript,
  type Moment,
  createEpisodeValidator,
  createNarrativeEngine,
  createWriterAgent,
  memoryNarrativeStorage,
  simulationReader,
} from '../src/index.js';

/** Une vraie époque Palmiers (scheduler, interactions, politique aléatoire déterministe) mise en épisode. */
describe('épisode produit à partir d’un journal réel (époque Palmiers simulée)', () => {
  it('produit des scènes valides et sourcées, de façon reproductible', async () => {
    const sim = createMemoryStorage();
    const fixture = await seedWorld(sim, aWorld().build());
    await createEpochScheduler({
      storage: sim,
      decision: new UniformRandomPolicy({ moveProbability: 0.5 }),
      outcome: new HeuristicOutcomeModel(),
      hooks: { tick: [interactionHook()], economy: economyHook() },
    }).run({ worldId: fixture.world.id, seasonNumber: fixture.season.number, number: 0 }).done;
    const epochId = (await sim.tx((s) => s.epochs.findByNumber(fixture.world.id, 0)))?.id ?? '';
    const journal = await sim.tx((s) => s.journal.read(epochId));
    expect(journal.events.length).toBeGreaterThan(5);

    const storage = memoryNarrativeStorage(sim);
    const options = { targetSeconds: 90, minScreenTimePerPlayer: 10 };
    const probe = createNarrativeEngine({ storage, writer: createWriterAgent({ llm: new FakeLLM() }), options });
    const digest = await probe.collect(epochId);
    const moments = await probe.select(digest, options);
    expect(moments.length).toBeGreaterThan(0);
    expect(moments.reduce((s, m) => s + m.seconds, 0)).toBeLessThanOrEqual(90);

    // Le « scénariste » : une scène par moment, à l'endroit où l'event s'est passé, avec ceux qui y étaient.
    const sceneOf = (m: Moment) => {
      const where = journal.scenes.find((s) => s.id === m.sceneId);
      const present = journal.presences
        .filter(
          (p) =>
            p.kind === 'scene' &&
            p.sceneId === m.sceneId &&
            p.tickStart <= m.tick &&
            (p.tickEnd === null || m.tick < p.tickEnd),
        )
        .map((p) => p.characterId);
      return {
        locationId: where?.locationId ?? m.locationId ?? '',
        characterIds: [...new Set(present)].sort(),
        tone: 'neutre',
        summary: m.summary,
        seconds: m.seconds,
        sources: [m.eventId],
        shots: [{ kind: 'wide' as const, description: m.summary, characterIds: [] }],
        lines: journal.utterances
          .filter((u) => m.utteranceIds.includes(u.id))
          .map((u) => ({
            kind: 'dialogue' as const,
            speakerId: u.speakerId,
            text: u.text,
            utteranceId: u.id,
            tone: u.tone,
          })),
        claims: [],
      };
    };
    const script: EpisodeScript = {
      title: 'Journée à la villa',
      synopsis: 'Les moments forts de la journée.',
      cliffhanger: null,
      scenes: moments.map(sceneOf),
    };
    const llm = new FakeLLM({ rules: [{ purpose: 'write', replies: [script] }] });
    const engine = createNarrativeEngine({ storage, writer: createWriterAgent({ llm }), options });

    const episode = await engine.produce(epochId);

    expect(episode.issues).toEqual([]);
    expect(episode.status).toBe('validated');
    expect(episode.script.scenes).toHaveLength(moments.length);
    const eventIds = new Set(journal.events.map((e) => e.id));
    for (const scene of episode.script.scenes) for (const id of scene.sources) expect(eventIds.has(id)).toBe(true);

    // Un script qui montre quelqu'un d'absent est rejeté sur ce même journal réel.
    const first = episode.script.scenes[0];
    const absent = Object.values(IDS.characters).find((c) => first && !first.characterIds.includes(c));
    if (first && absent) {
      const verdict = await createEpisodeValidator({ sim: simulationReader(sim), worldId: fixture.world.id }).validate({
        ...script,
        scenes: [{ ...first, characterIds: [...first.characterIds, absent] }],
      });
      expect(verdict.issues.map((i) => i.code)).toContain('character_absent');
    }

    // Reproductible : même graine, même sélection.
    expect((await probe.select(digest, options)).map((m) => m.eventId)).toEqual(moments.map((m) => m.eventId));
  });
});
