import { beforeAll, describe, expect, it } from 'vitest';
import { fixedId } from '@ai-reality/testkit';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import {
  type EpisodeValidator,
  type IssueCode,
  type ScriptLine,
  createEpisodeValidator,
  simulationReader,
} from '../src/index.js';
import { C, EVT, L, LINES, UTTERANCE, seedBetrayal } from './helpers/betrayal.js';
import { goodScript, sceneProposal, withScene } from './helpers/script.js';
import { IDS } from '@ai-reality/testkit';

let validator: EpisodeValidator;
beforeAll(async () => {
  const sim = createMemoryStorage();
  await seedBetrayal(sim);
  validator = createEpisodeValidator({ sim: simulationReader(sim), worldId: IDS.world });
});

const codes = async (
  script: Parameters<EpisodeValidator['validate']>[0],
  opts?: Parameters<EpisodeValidator['validate']>[1],
): Promise<IssueCode[]> => (await validator.validate(script, opts)).issues.map((i) => i.code);

describe('validateur d’épisode', () => {
  it('accepte un script cohérent avec le journal', async () => {
    const result = await validator.validate(goodScript(), { maxSeconds: 130 });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.durationSeconds).toBe(125);
  });

  it('rejette une scène qui cite un event inexistant', async () => {
    const ghost = fixedId(0x76, 999);
    const script = withScene(1, { sources: [EVT.confidence, ghost] });
    const result = await validator.validate(script);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'unknown_event', eventId: ghost, sceneIndex: 1 })]);
  });

  it('rejette un personnage montré dans une scène où il est absent', async () => {
    // Thomas est à la cuisine puis au jardin ; il n'est pas au jardin au tick 1.
    const script = withScene(0, { characterIds: [C.alexandre, C.sarah, C.thomas] });
    const result = await validator.validate(script);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'character_absent', characterId: C.thomas, sceneIndex: 0 }),
    ]);
  });

  it('rejette un personnage présent ailleurs au même moment', async () => {
    // Léa est au salon à ce moment-là, pas au jardin de la scène 4.
    const script = withScene(3, { characterIds: [C.alexandre, C.lea] });
    expect(await codes(script)).toEqual(['character_absent']);
  });

  it('rejette une scène dont la source se passe ailleurs', async () => {
    expect(await codes(withScene(1, { locationId: L.jardin }))).toContain('source_location_mismatch');
  });

  it('rejette un dialogue qui contredit la réplique du journal', async () => {
    const scene = sceneProposal();
    const altered = {
      ...scene,
      lines: scene.lines.map((l, i) => (i === 0 ? { ...l, text: 'Sarah, je te déteste.' } : l)),
    };
    const result = await validator.validate(withScene(0, altered));
    expect(result.issues.map((i) => i.code)).toEqual(['utterance_mismatch']);
  });

  it('rejette un dialogue sans réplique source, une réplique inconnue, ou prononcé par un absent', async () => {
    const scene = sceneProposal();
    const line = (patch: Partial<ScriptLine>) => ({
      ...scene,
      lines: [{ ...(scene.lines[0] as ScriptLine), ...patch }],
    });
    expect(await codes(withScene(0, line({ utteranceId: null })))).toEqual(['unknown_utterance']);
    expect(await codes(withScene(0, line({ utteranceId: fixedId(0x74, 99) })))).toEqual(['unknown_utterance']);
    expect(await codes(withScene(0, line({ speakerId: C.lea, utteranceId: UTTERANCE[0] ?? null })))).toEqual(
      expect.arrayContaining(['speaker_not_in_scene', 'utterance_mismatch']),
    );
  });

  it('rejette une conséquence annoncée que le journal contredit', async () => {
    // Le journal montre l'alliance Sarah→Alexandre en baisse à la trahison.
    const wrongWay = {
      eventId: EVT.betrayal,
      characterId: C.sarah,
      otherCharacterId: C.alexandre,
      dimension: 'alliance',
      direction: 'up' as const,
    };
    const unknown = {
      eventId: EVT.betrayal,
      characterId: C.sarah,
      otherCharacterId: C.alexandre,
      dimension: 'fear',
      direction: 'up' as const,
    };
    expect(await codes(withScene(3, { claims: [wrongWay] }))).toEqual(['claim_contradiction']);
    expect(await codes(withScene(3, { claims: [unknown] }))).toEqual(['claim_contradiction']);
    expect(await codes(withScene(3, { claims: [{ ...wrongWay, eventId: EVT.rumor }] }))).toEqual([
      'claim_not_in_sources',
    ]);
  });

  it('rejette un script qui dépasse la durée', async () => {
    const result = await validator.validate(goodScript(), { maxSeconds: 100 });
    expect(result.issues).toEqual([expect.objectContaining({ code: 'duration_exceeded', sceneIndex: null })]);
  });

  it('rejette un confessionnal qui n’a pas été enregistré', async () => {
    const script = withScene(1, {
      lines: [
        {
          kind: 'confessional',
          speakerId: C.sarah,
          text: 'Je ne fais confiance à personne.',
          utteranceId: null,
          tone: null,
        },
      ],
    });
    expect(await codes(script, { confessionals: [] })).toEqual(['confessional_unrecorded']);
    expect(
      await codes(script, { confessionals: [{ speakerId: C.sarah, text: 'Je ne fais confiance à personne.' }] }),
    ).toEqual([]);
  });

  it('rejette un lieu ou un personnage inconnu', async () => {
    const result = await validator.validate(
      withScene(2, { locationId: fixedId(0x10, 99), characterIds: [C.lea, fixedId(0x30, 99)] }),
    );
    expect(result.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['unknown_location', 'unknown_character']));
  });

  it('les répliques recopiées mot pour mot passent malgré des espaces différents', async () => {
    const scene = sceneProposal();
    const spaced = {
      ...scene,
      lines: scene.lines.map((l, i) => (i === 1 ? { ...l, text: `  ${LINES[1] ?? ''} ` } : l)),
    };
    expect(await codes(withScene(0, spaced))).toEqual([]);
  });
});
