/**
 * Épisode « l'alliance trahie » de bout en bout : la vraie chaîne A→B→C→D jouée par le scheduler
 * (alliance proposée, confidence, rumeur, confrontation) devient un épisode de 4 scènes sourcées.
 * Une suite, deux stockages (mémoire, PostgreSQL).
 */
import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '@ai-reality/engine';
import type { EventRecord, StoragePort } from '@ai-reality/engine';
import { FakeLLM, IDS, playChainEpoch } from '@ai-reality/testkit';
import {
  type EpisodeScript,
  type NarrativeStoragePort,
  createConfessionalService,
  createNarrativeEngine,
  createWriterAgent,
  personaProvider,
  storageContextProvider,
} from '../../src/index.js';

export interface ChainHarness {
  readonly sim: StoragePort;
  readonly narrative: NarrativeStoragePort;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const { alexandre, sarah, lea, thomas } = IDS.characters;
const OPTIONS = { targetSeconds: 200, minScreenTimePerPlayer: 0, minImportance: 0, confessionalsPerArc: 4 };

export function chainEpisodeSuite(name: string, factory: () => Promise<ChainHarness>): void {
  describe(`épisode 14 « l'alliance trahie » sur la vraie chaîne (${name})`, () => {
    it('reconstruit l’arc E1←E2←E3←E4, produit 4 scènes valides sourcées et un confessionnal de Sarah qui ignore la confrontation', async () => {
      const h = await factory();
      try {
        await h.reset();
        const { fixture, epochId } = await playChainEpoch(h.sim);
        const journal = await h.sim.tx((s) => s.journal.read(epochId));
        const byType = (type: string): EventRecord[] => journal.events.filter((e) => e.type === type);
        const [e1] = byType('alliance_formed');
        const [e2, e3] = byType('secret_shared');
        const [e4] = byType('confrontation');
        if (!e1 || !e2 || !e3 || !e4) throw new Error('chaîne incomplète dans le journal');
        const chain = [e1, e2, e3, e4];

        // Le « scénariste » : une scène par maillon, au lieu et avec les présents du journal.
        const scene = (e: EventRecord): EpisodeScript['scenes'][number] => {
          const where = journal.scenes.find((s) => s.id === e.sceneId);
          const present = journal.presences
            .filter(
              (p) =>
                p.kind === 'scene' &&
                p.sceneId === e.sceneId &&
                p.tickStart <= e.tick &&
                (p.tickEnd === null || e.tick < p.tickEnd),
            )
            .map((p) => p.characterId);
          const betrayal = journal.effects.find((f) => f.eventId === e.id && f.ruleId === 'confront_betrayal');
          return {
            locationId: where?.locationId ?? e.locationId ?? '',
            characterIds: [...new Set(present)].sort(),
            tone: e === e4 ? 'explosif' : 'tendu',
            summary: `${e.type} (tick ${String(e.tick)})`,
            seconds: 30,
            sources: [e.id],
            shots: [{ kind: 'medium', description: e.type, characterIds: [] }],
            lines: [],
            claims: betrayal
              ? [
                  {
                    eventId: e.id,
                    characterId: betrayal.characterId,
                    otherCharacterId: betrayal.otherCharacterId,
                    dimension: betrayal.dimension,
                    direction: betrayal.delta > 0 ? 'up' : 'down',
                  },
                ]
              : [],
          };
        };
        const script: EpisodeScript = {
          title: 'L’alliance trahie',
          synopsis: 'Une alliance proposée au jardin remonte la chaîne des confidences jusqu’à la confrontation.',
          cliffhanger: 'Alexandre sait qui a parlé.',
          scenes: chain.map(scene),
        };

        const llm = new FakeLLM({
          rules: [
            { purpose: 'interview', replies: [{ answer: 'Je ne sais pas s’il est sincère…', reveals: [] }] },
            { purpose: 'write', replies: [script] },
          ],
        });
        const engine = createNarrativeEngine({
          storage: h.narrative,
          writer: createWriterAgent({ llm }),
          confessional: createConfessionalService({
            runtime: createAgentRuntime({ llm, persona: await personaProvider(h.narrative.sim, fixture.world.id) }),
            contextFor: storageContextProvider(h.sim),
          }),
          options: OPTIONS,
        });

        const episode = await engine.produce(epochId);

        // L'arc reconstruit par les caused_by.
        expect([e2.causedByEventId, e3.causedByEventId, e4.causedByEventId]).toEqual([e1.id, e2.id, e3.id]);
        const arc = episode.arcs.find((a) => a.rootEventId === e1.id);
        expect(arc?.eventIds).toEqual(chain.map((e) => e.id));
        expect(arc?.characterIds).toEqual([alexandre, sarah, lea, thomas].sort());

        // Quatre scènes valides, avec sources.
        expect(episode.issues).toEqual([]);
        expect(episode.status).toBe('validated');
        expect(episode.script.scenes).toHaveLength(4);
        expect(episode.script.scenes.map((s) => s.sources)).toEqual(chain.map((e) => [e.id]));
        const stored = (await h.narrative.episodes.episodes(fixture.world.id))[0];
        expect(stored).toMatchObject({ status: 'validated', number: 0, durationSeconds: 120 });
        expect(stored?.scenes).toHaveLength(4);

        // Le confessionnal de Sarah : persona réel, contexte d'avant la confrontation.
        const interview = llm.requestsFor('interview').find((r) => r.characterId === sarah);
        expect(interview).toBeDefined();
        expect(interview?.system.stable).toContain('Tu es Sarah');
        const sent = JSON.stringify(interview);
        for (const leak of ['confront', 'traitor', e4.id, 'Thomas']) expect(sent).not.toContain(leak);

        const chainArc = arc ?? episode.arcs[0];
        if (!chainArc) throw new Error('arc absent');
        const arcCtx = await storageContextProvider(h.sim)(sarah, chainArc);
        const towardAlexandre = arcCtx.relationships.find((r) => r.targetId === alexandre);
        expect(towardAlexandre?.axes.alliance).toBeGreaterThan(0);
        expect(towardAlexandre?.labels).not.toContain('rival');
        // Alexandre n'a pas encore appris d'où vient la fuite.
        const alexCtx = await storageContextProvider(h.sim)(alexandre, chainArc);
        expect(alexCtx.knowledge.every((k) => k.provenance.toldById !== thomas)).toBe(true);
        expect(episode.confessionals.some((c) => c.speakerId === sarah)).toBe(true);
      } finally {
        await h.close();
      }
    }, 60_000);
  });
}
