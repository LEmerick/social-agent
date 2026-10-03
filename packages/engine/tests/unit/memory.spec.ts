/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { FakeEmbedding, IDS, aSimState, fixedId } from '@ai-reality/testkit';
import { createIdFactory } from '../../src/core/id.js';
import { ManualClock } from '../../src/core/clock.js';
import { Rng } from '../../src/core/rng.js';
import {
  DEFAULT_MEMORY_CONFIG,
  type DecayedMemory,
  type MemoryRecord,
  applyDecay,
  createMemoryService,
  decay,
  memoriesFromEvents,
  rankForRecall,
  recalled,
} from '../../src/memory/index.js';
import { C, anEvent, epochId, seedEpochs } from '../helpers/memory-kit.js';

const fake = new FakeEmbedding();
const ids = () => createIdFactory(new ManualClock(1_800_000_000_000), Rng.derive('memory-tests', 'ids'));

function record(n: number, summary: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: fixedId(0x70, n),
    characterId: C.sarah,
    eventId: null,
    epochId: epochId(0),
    kind: 'episodic',
    summary,
    emotion: null,
    salience: 0.5,
    aboutCharacterIds: [],
    embedding: fake.vectorOf(summary),
    lastRecalledEpoch: null,
    ...over,
  };
}
const asDecayed = (r: MemoryRecord, salience = r.salience): DecayedMemory => ({ record: r, salience });

describe('décroissance', () => {
  it('divise la saillance par deux à chaque demi-vie et ne change rien sans délai', () => {
    expect(decay(0.8, 0, 10)).toBe(0.8);
    expect(decay(0.8, -3, 10)).toBe(0.8);
    expect(decay(0.8, 10, 10)).toBeCloseTo(0.4, 10);
    expect(decay(0.8, 20, 10)).toBeCloseTo(0.2, 10);
    expect(decay(0.8, 3, 10)).toBeLessThan(decay(0.8, 2, 10));
    expect(() => decay(0.5, 1, 0)).toThrow(RangeError);
  });

  it('applyDecay part du dernier rappel, à défaut de l’époque de création', () => {
    const created = record(1, 'a', { epochId: epochId(2), salience: 0.8 });
    const touched = record(2, 'b', { epochId: epochId(2), salience: 0.8, lastRecalledEpoch: 12 });
    const [x, y] = applyDecay([created, touched], 12, new Map([[epochId(2), 2]]), 10);
    expect(x!.salience).toBeCloseTo(0.4, 10);
    expect(y!.salience).toBe(0.8);
  });

  it('un souvenir rappelé remonte et repart de l’époque du rappel', () => {
    const before = asDecayed(record(1, 'a'), 0.25);
    const after = recalled(before, 20, 0.3);
    expect(after.salience).toBeCloseTo(0.25 + 0.75 * 0.3, 10);
    expect(after.lastRecalledEpoch).toBe(20);
    expect(recalled(asDecayed(record(2, 'b'), 1), 1, 0.3).salience).toBe(1);
  });
});

describe('memoriesFromEvents', () => {
  const state = aSimState();
  const proposal = anEvent(
    14,
    'alliance_proposed',
    [
      [C.alexandre, 'actor'],
      [C.sarah, 'target'],
      [C.lea, 'witness'],
    ],
    0.7,
  );
  const smallTalk = anEvent(
    14,
    'small_talk',
    [
      [C.lea, 'actor'],
      [C.thomas, 'target'],
    ],
    0.1,
  );

  it('crée un souvenir à la première personne par event vécu, rien pour les autres', () => {
    const sarah = memoriesFromEvents(state, C.sarah, [proposal, smallTalk], ids());
    expect(sarah).toHaveLength(1);
    expect(sarah[0]).toMatchObject({
      characterId: C.sarah,
      eventId: proposal.id,
      epochId: proposal.epochId,
      kind: 'episodic',
      emotion: 'méfiance',
      aboutCharacterIds: [C.alexandre, C.lea].sort(),
    });
    expect(sarah[0]!.summary).toBe(`${state.characters[C.alexandre]!.firstName} m’a proposé une alliance.`);

    const alexandre = memoriesFromEvents(state, C.alexandre, [proposal], ids());
    expect(alexandre[0]!.summary).toContain('J’ai proposé une alliance à');
  });

  it('la saillance croît avec l’implication : cible > témoin', () => {
    const target = memoriesFromEvents(state, C.sarah, [proposal], ids())[0]!;
    const witness = memoriesFromEvents(state, C.lea, [proposal], ids())[0]!;
    expect(target.salience).toBeGreaterThan(witness.salience);
    expect(witness.summary).toContain('J’ai vu');
  });

  it('`max` garde les plus saillants dans l’ordre des events ; résultat déterministe', () => {
    const insult = anEvent(
      14,
      'insult',
      [
        [C.thomas, 'actor'],
        [C.sarah, 'target'],
      ],
      0.9,
    );
    const chat = anEvent(
      14,
      'small_talk',
      [
        [C.lea, 'actor'],
        [C.sarah, 'target'],
      ],
      0.5,
    );
    const kept = memoriesFromEvents(state, C.sarah, [proposal, insult, chat], ids(), { max: 2 });
    expect(kept.map((m) => m.eventId)).toEqual([proposal.id, insult.id]);
    expect(memoriesFromEvents(state, C.sarah, [proposal, insult, chat], ids())).toEqual(
      memoriesFromEvents(state, C.sarah, [proposal, insult, chat], ids()),
    );
  });
});

describe('rankForRecall', () => {
  const items = [
    record(1, 'Alexandre m’a proposé une alliance dans le jardin', { aboutCharacterIds: [C.alexandre] }),
    record(2, 'Thomas a cuisiné des pâtes pour tout le monde', { aboutCharacterIds: [C.thomas] }),
    record(3, 'Alexandre a gagné le défi de la piscine', { aboutCharacterIds: [C.alexandre], salience: 0.3 }),
    record(4, 'Léa m’a confié un secret sur la cuisine', { characterId: C.lea, aboutCharacterIds: [C.alexandre] }),
  ].map((r) => asDecayed(r));

  it('ne renvoie jamais les souvenirs d’un autre personnage', () => {
    const ranked = rankForRecall(items, { characterId: C.sarah, about: [C.alexandre], k: 10 });
    expect(ranked.map((x) => x.record.id)).toEqual([fixedId(0x70, 1), fixedId(0x70, 3), fixedId(0x70, 2)]);
    expect(ranked.every((x) => x.record.characterId === C.sarah)).toBe(true);
    expect(rankForRecall(items, { characterId: C.thomas, about: [C.alexandre], k: 10 })).toEqual([]);
  });

  it('combine similarité et personnes concernées', async () => {
    const [query] = await fake.embed(['alliance proposée dans le jardin']);
    const bySimilarity = rankForRecall(items, { characterId: C.sarah, queryEmbedding: query!, k: 1 });
    expect(bySimilarity[0]!.record.id).toBe(fixedId(0x70, 1));
    expect(bySimilarity[0]!.similarity).toBeGreaterThan(0.5);

    const [pasta] = await fake.embed(['pâtes cuisinées']);
    const mixed = rankForRecall(items, { characterId: C.sarah, queryEmbedding: pasta!, k: 3 });
    expect(mixed[0]!.record.id).toBe(fixedId(0x70, 2));
  });

  it('une saillance décrue fait descendre un souvenir, `k` borne le résultat', () => {
    const faded = [asDecayed(items[0]!.record, 0.01), asDecayed(items[2]!.record, 0.9)];
    const ranked = rankForRecall(faded, { characterId: C.sarah, k: 1 });
    expect(ranked.map((x) => x.record.id)).toEqual([fixedId(0x70, 3)]);
  });
});

describe('MemoryService', () => {
  const drafts = (characterId: string, rows: [number, string, string[]][]) =>
    rows.map(([n, summary, about]) => ({
      id: fixedId(0x70, n),
      characterId,
      eventId: null,
      epochId: epochId(1),
      kind: 'episodic' as const,
      summary,
      emotion: null,
      salience: 0.5,
      aboutCharacterIds: about,
    }));

  it('recall est isolé par personnage : aucune fuite entre agents', async () => {
    const storage = createMemoryStorage();
    await seedEpochs(storage, 5);
    const service = createMemoryService(storage, fake);
    await service.record(C.sarah, drafts(C.sarah, [[1, 'Alexandre m’a proposé une alliance', [C.alexandre]]]));
    await service.record(
      C.thomas,
      drafts(C.thomas, [[2, 'Alexandre m’a proposé une alliance secrète', [C.alexandre]]]),
    );

    for (const request of [
      { about: [C.alexandre], k: 5, epoch: 3 },
      { text: 'alliance avec Alexandre', k: 5, epoch: 3 },
      { k: 5, epoch: 3 },
    ]) {
      const sarah = await service.recall(C.sarah, request);
      expect(sarah.map((x) => x.record.id)).toEqual([fixedId(0x70, 1)]);
      const lea = await service.recall(C.lea, request);
      expect(lea).toEqual([]);
    }
  });

  it('refuse un souvenir d’un autre personnage et un embedding de mauvaise dimension', async () => {
    const storage = createMemoryStorage();
    await seedEpochs(storage, 1);
    await expect(
      createMemoryService(storage, fake).record(C.sarah, drafts(C.thomas, [[1, 'x', []]])),
    ).rejects.toMatchObject({ code: 'MEMORY_OWNER' });
    await expect(
      createMemoryService(storage, new FakeEmbedding(8)).record(C.sarah, drafts(C.sarah, [[1, 'x', []]])),
    ).resolves.toHaveLength(1);
  });

  it('un souvenir rappelé remonte ; decay(monde) donne la saillance décrue sans rien écrire', async () => {
    const storage = createMemoryStorage();
    await seedEpochs(storage, 30);
    const service = createMemoryService(storage, fake, DEFAULT_MEMORY_CONFIG);
    await service.record(
      C.sarah,
      drafts(C.sarah, [
        [1, 'Alexandre m’a proposé une alliance', [C.alexandre]],
        [2, 'Léa a préparé le déjeuner', [C.lea]],
      ]),
    );

    const view = await service.decay(IDS.world, 11);
    expect(view.map((d) => d.salience.toFixed(3))).toEqual(['0.250', '0.250']);

    const [first] = await service.recall(C.sarah, { about: [C.alexandre], k: 1, epoch: 11 });
    expect(first!.record.id).toBe(fixedId(0x70, 1));
    const after = await service.decay(IDS.world, 11);
    const rappelé = after.find((d) => d.record.id === fixedId(0x70, 1))!;
    const oublié = after.find((d) => d.record.id === fixedId(0x70, 2))!;
    expect(rappelé.salience).toBeGreaterThan(oublié.salience);
    expect(rappelé.record.lastRecalledEpoch).toBe(11);
    expect(rappelé.salience).toBeCloseTo(0.25 + 0.75 * 0.3, 5);
  });
});
