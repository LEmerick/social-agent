/**
 * Journal « l'alliance trahie » (épisode 14) écrit à la main dans un stockage mémoire : quatre scènes liées par
 * `caused_by_event_id` (proposition au jardin → confidence au salon → rumeur à la cuisine → trahison au jardin),
 * plus du bruit de fond (bavardage, événement isolé).
 */
import type {
  EffectRecord,
  EventRecord,
  InteractionRecord,
  PresenceRecord,
  SceneRecord,
  StoragePort,
  UtteranceRecord,
} from '@ai-reality/engine';
import { emptyTickBatch } from '@ai-reality/engine';
import { type WorldFixture, IDS, aWorld, fixedId, seedWorld } from '@ai-reality/testkit';

export const C = IDS.characters;
export const L = IDS.locations;
export const EPOCH_14 = fixedId(0, 14);

export const SCENE = {
  garden: fixedId(0x71, 4),
  lounge: fixedId(0x71, 5),
  kitchen: fixedId(0x71, 6),
  garden2: fixedId(0x71, 7),
};
export const EVT = {
  proposal: fixedId(0x76, 142),
  confidence: fixedId(0x76, 151),
  rumor: fixedId(0x76, 158),
  betrayal: fixedId(0x76, 163),
  chatter: fixedId(0x76, 170),
  lonely: fixedId(0x76, 171),
};
export const INTERACTION = { proposal: fixedId(0x73, 1) };
export const UTTERANCE = [1, 2, 3, 4].map((n) => fixedId(0x74, n));
export const LINES = [
  'Sarah, on devrait faire équipe, toi et moi.',
  'Pourquoi moi ? Je ne te connais pas si bien.',
  'Parce que tu es la seule à ne pas jouer double jeu.',
  'Alors d’accord, mais pas un mot à Léa.',
];

const scene = (id: string, locationId: string, tickStart: number, tickEnd: number): SceneRecord => ({
  id,
  epochId: EPOCH_14,
  locationId,
  zoneId: null,
  kind: 'free',
  tickStart,
  tickEnd,
});

let presenceRank = 0;
const present = (characterId: string, sceneId: string, tickStart: number, tickEnd: number): PresenceRecord => ({
  id: fixedId(0x72, ++presenceRank),
  epochId: EPOCH_14,
  characterId,
  tickStart,
  tickEnd,
  kind: 'scene',
  sceneId,
  fromLocationId: null,
  toLocationId: null,
  offstageReason: null,
  role: 'participant',
});

const event = (
  id: string,
  seq: number,
  tick: number,
  type: string,
  sceneId: string | null,
  locationId: string | null,
  importance: number,
  causedByEventId: string | null,
  who: readonly [string, string],
  interactionId: string | null = null,
): EventRecord => ({
  id,
  epochId: EPOCH_14,
  tick,
  seq,
  type,
  sceneId,
  interactionId,
  locationId,
  payload: {},
  importance,
  causedByEventId,
  participants: [
    { characterId: who[0], role: 'actor' },
    { characterId: who[1], role: 'target' },
  ],
});

const effect = (
  n: number,
  eventId: string,
  tick: number,
  characterId: string,
  otherCharacterId: string,
  dimension: string,
  delta: number,
  valueAfter: number,
): EffectRecord => ({
  id: fixedId(0x75, n),
  eventId,
  epochId: EPOCH_14,
  tick,
  targetKind: 'relationship',
  characterId,
  otherCharacterId,
  dimension,
  delta,
  valueAfter,
  ruleId: 'test',
  ruleVersion: 1,
  reason: null,
});

const proposalInteraction: InteractionRecord = {
  id: INTERACTION.proposal,
  epochId: EPOCH_14,
  sceneId: SCENE.garden,
  type: 'strategic',
  initiatorId: C.alexandre,
  tickStart: 1,
  tickEnd: 2,
  action: 'propose_alliance',
  outcome: 'accepted',
  mode: 'dialogue',
  classification: null,
  participants: [
    { characterId: C.alexandre, role: 'speaker' },
    { characterId: C.sarah, role: 'addressee' },
  ],
};

const utterances: UtteranceRecord[] = LINES.map((text, i) => ({
  id: UTTERANCE[i] ?? '',
  interactionId: INTERACTION.proposal,
  seq: i,
  tick: 1,
  speakerId: i % 2 === 0 ? C.alexandre : C.sarah,
  addresseeIds: [i % 2 === 0 ? C.sarah : C.alexandre],
  text,
  intent: null,
  tone: 'posé',
  emotion: null,
  volume: 'normal',
  revealedFactIds: [],
  llmCallId: null,
}));

export interface BetrayalWorld {
  readonly fixture: WorldFixture;
  readonly epochId: string;
}

export async function seedBetrayal(
  storage: StoragePort,
  epochStatus: 'completed' | 'running' = 'completed',
): Promise<BetrayalWorld> {
  presenceRank = 0;
  const fixture = await seedWorld(storage, aWorld().build());
  await storage.tx(async (s) => {
    await s.epochs.insert({
      id: EPOCH_14,
      worldId: IDS.world,
      seasonId: IDS.season,
      number: 14,
      status: epochStatus,
      rngSeed: 'x',
      rulesVersion: 1,
      lastCommittedTick: -1,
    });
    await s.journal.commitTick({
      ...emptyTickBatch(EPOCH_14, 22),
      scenesOpened: [
        scene(SCENE.garden, L.jardin, 0, 5),
        scene(SCENE.lounge, L.salon, 5, 10),
        scene(SCENE.kitchen, L.cuisine, 10, 15),
        scene(SCENE.garden2, L.jardin, 15, 22),
      ],
      presencesOpened: [
        present(C.alexandre, SCENE.garden, 0, 5),
        present(C.sarah, SCENE.garden, 0, 5),
        present(C.lea, SCENE.garden, 0, 5),
        present(C.sarah, SCENE.lounge, 5, 10),
        present(C.lea, SCENE.lounge, 5, 10),
        present(C.lea, SCENE.kitchen, 10, 15),
        present(C.thomas, SCENE.kitchen, 10, 15),
        present(C.alexandre, SCENE.garden2, 15, 22),
        present(C.sarah, SCENE.garden2, 15, 22),
        present(C.thomas, SCENE.garden2, 15, 22),
      ],
      interactions: [proposalInteraction],
      utterances,
      events: [
        event(
          EVT.proposal,
          1,
          1,
          'alliance_proposed',
          SCENE.garden,
          L.jardin,
          0.85,
          null,
          [C.alexandre, C.sarah],
          INTERACTION.proposal,
        ),
        event(EVT.confidence, 2, 6, 'secret_told', SCENE.lounge, L.salon, 0.7, EVT.proposal, [C.sarah, C.lea]),
        event(EVT.rumor, 3, 11, 'rumor_spread', SCENE.kitchen, L.cuisine, 0.75, EVT.confidence, [C.lea, C.thomas]),
        event(EVT.betrayal, 4, 16, 'alliance_betrayed', SCENE.garden2, L.jardin, 0.95, EVT.rumor, [
          C.thomas,
          C.alexandre,
        ]),
        event(EVT.chatter, 5, 2, 'small_talk', SCENE.garden, L.jardin, 0.1, null, [C.alexandre, C.lea]),
        event(EVT.lonely, 6, 18, 'item_found', SCENE.garden2, L.jardin, 0.5, null, [C.sarah, C.sarah]),
      ],
      effects: [
        effect(1, EVT.proposal, 1, C.sarah, C.alexandre, 'trust', 12, 42),
        effect(2, EVT.confidence, 6, C.lea, C.sarah, 'alliance', 5, 85),
        effect(3, EVT.betrayal, 16, C.sarah, C.alexandre, 'alliance', -40, 0),
        effect(4, EVT.betrayal, 16, C.sarah, C.alexandre, 'rivalry', 30, 30),
      ],
    });
  });
  return { fixture, epochId: EPOCH_14 };
}
