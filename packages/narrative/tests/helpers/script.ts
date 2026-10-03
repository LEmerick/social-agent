/** Scripts d'épisode de test : un script correct pour le journal « alliance trahie », et de quoi le dégrader. */
import type { EpisodeScript, ScriptScene } from '../../src/index.js';
import { C, EVT, L, LINES, UTTERANCE } from './betrayal.js';

const shot = (description: string, characterIds: string[] = []) => ({
  kind: 'medium' as const,
  description,
  characterIds,
});

export const sceneProposal = (): ScriptScene => ({
  locationId: L.jardin,
  characterIds: [C.alexandre, C.sarah],
  tone: 'tendu',
  summary: 'Alexandre propose une alliance à Sarah au jardin.',
  seconds: 40,
  sources: [EVT.proposal],
  shots: [shot('Alexandre aborde Sarah sur le banc', [C.alexandre, C.sarah])],
  lines: [
    { kind: 'dialogue', speakerId: C.alexandre, text: LINES[0] ?? '', utteranceId: UTTERANCE[0] ?? null, tone: 'posé' },
    { kind: 'dialogue', speakerId: C.sarah, text: LINES[1] ?? '', utteranceId: UTTERANCE[1] ?? null, tone: 'posé' },
    {
      kind: 'voiceover',
      speakerId: null,
      text: 'Tout commence par une poignée de main.',
      utteranceId: null,
      tone: null,
    },
  ],
  claims: [
    { eventId: EVT.proposal, characterId: C.sarah, otherCharacterId: C.alexandre, dimension: 'trust', direction: 'up' },
  ],
});

export const goodScript = (): EpisodeScript => ({
  title: 'L’alliance trahie',
  synopsis: 'Une alliance proposée au jardin se retourne en rivalité.',
  cliffhanger: 'Sarah comprend qui a parlé.',
  scenes: [
    sceneProposal(),
    {
      locationId: L.salon,
      characterIds: [C.sarah, C.lea],
      tone: 'confidentiel',
      summary: 'Sarah se confie à Léa.',
      seconds: 25,
      sources: [EVT.confidence],
      shots: [shot('Sarah chuchote à Léa', [C.sarah, C.lea])],
      lines: [],
      claims: [],
    },
    {
      locationId: L.cuisine,
      characterIds: [C.lea, C.thomas],
      tone: 'léger',
      summary: 'La rumeur arrive à Thomas.',
      seconds: 25,
      sources: [EVT.rumor],
      shots: [shot('Léa et Thomas à la cuisine', [C.lea, C.thomas])],
      lines: [],
      claims: [],
    },
    {
      locationId: L.jardin,
      characterIds: [C.alexandre, C.sarah, C.thomas],
      tone: 'explosif',
      summary: 'Thomas dévoile l’alliance.',
      seconds: 35,
      sources: [EVT.betrayal],
      shots: [shot('Face-à-face', [C.alexandre, C.sarah])],
      lines: [],
      claims: [
        {
          eventId: EVT.betrayal,
          characterId: C.sarah,
          otherCharacterId: C.alexandre,
          dimension: 'alliance',
          direction: 'down',
        },
        {
          eventId: EVT.betrayal,
          characterId: C.sarah,
          otherCharacterId: C.alexandre,
          dimension: 'rivalry',
          direction: 'up',
        },
      ],
    },
  ],
});

/** Copie du bon script dont on remplace une scène. */
export function withScene(index: number, patch: Partial<ScriptScene>): EpisodeScript {
  const script = goodScript();
  return { ...script, scenes: script.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}
