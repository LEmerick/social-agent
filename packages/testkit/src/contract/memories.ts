import { describe, expect, it } from 'vitest';
import type { MemoryRecord } from '@ai-reality/engine';
import { seedWorld } from '../builders.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { type HarnessRef, expectCode } from './support.js';

const C = IDS.characters;
const DIM = 1024;

/** Vecteur creux (valeurs exactes en float32) : `axis(0, 1, 1, 0.5)` = 1 sur l'axe 0, 0.5 sur l'axe 1. */
const axis = (...values: number[]): number[] => Array.from({ length: DIM }, (_, i) => values[i] ?? 0);

function memory(n: number, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: fixedId(0x70, n),
    characterId: C.sarah,
    eventId: null,
    epochId: IDS.epoch,
    kind: 'episodic',
    summary: `Souvenir ${String(n)}`,
    emotion: 'joie',
    salience: 0.5,
    aboutCharacterIds: [C.alexandre],
    embedding: axis(1, 0),
    lastRecalledEpoch: null,
    ...overrides,
  };
}

export function memoriesContract(h: HarnessRef): void {
  describe('souvenirs (memory)', () => {
    it('un souvenir se relit à l’identique (avec ou sans embedding), trié par id', async () => {
      await seedWorld(h().storage);
      const full = memory(2, { embedding: axis(0.5, 0.25), salience: 0.75, kind: 'reflection', lastRecalledEpoch: 3 });
      const sparse = memory(1, { embedding: null, emotion: null, aboutCharacterIds: [], salience: 0.25 });
      await h().storage.tx((s) => s.memories.insert([full, sparse]));
      expect(await h().storage.tx((s) => s.memories.listByCharacter(C.sarah))).toEqual([sparse, full]);
      expect(await h().storage.tx((s) => s.memories.listByCharacter(C.thomas))).toEqual([]);
    });

    it('search ne renvoie que les souvenirs du personnage, du plus proche au plus lointain, limité à k', async () => {
      await seedWorld(h().storage);
      const near = memory(1, { embedding: axis(1, 0.25) });
      const mid = memory(2, { embedding: axis(1, 1) });
      const far = memory(3, { embedding: axis(0, 1) });
      const unembedded = memory(4, { embedding: null });
      const stranger = memory(5, { characterId: C.thomas, embedding: axis(1, 0) });
      await h().storage.tx((s) => s.memories.insert([far, stranger, unembedded, mid, near]));

      const hits = await h().storage.tx((s) => s.memories.search(C.sarah, axis(1, 0), 10));
      expect(hits.map((x) => x.record)).toEqual([near, mid, far]);
      expect(hits[0]?.similarity).toBeCloseTo(1 / Math.sqrt(1 + 0.0625), 5);
      expect(hits[1]?.similarity).toBeCloseTo(1 / Math.SQRT2, 5);
      expect(hits[2]?.similarity).toBeCloseTo(0, 5);

      expect((await h().storage.tx((s) => s.memories.search(C.sarah, axis(1, 0), 2))).map((x) => x.record.id)).toEqual([
        near.id,
        mid.id,
      ]);
      expect((await h().storage.tx((s) => s.memories.search(C.thomas, axis(1, 0), 5))).map((x) => x.record.id)).toEqual(
        [stranger.id],
      );
    });

    it('updateRecall met à jour saillance et dernier rappel ; souvenir inconnu ⇒ NOT_FOUND', async () => {
      await seedWorld(h().storage);
      await h().storage.tx((s) => s.memories.insert([memory(1)]));
      await h().storage.tx((s) => s.memories.updateRecall(fixedId(0x70, 1), { salience: 0.75, lastRecalledEpoch: 15 }));
      const [stored] = await h().storage.tx((s) => s.memories.listByCharacter(C.sarah));
      expect(stored).toEqual(memory(1, { salience: 0.75, lastRecalledEpoch: 15 }));
      await expectCode(
        h().storage.tx((s) => s.memories.updateRecall(fixedId(0x70, 9), { salience: 0.5, lastRecalledEpoch: 1 })),
        'NOT_FOUND',
      );
    });

    it('identifiant en double ⇒ DUPLICATE, personnage ou event inconnu ⇒ NOT_FOUND, transaction annulée', async () => {
      await seedWorld(h().storage);
      await h().storage.tx((s) => s.memories.insert([memory(1)]));
      await expectCode(
        h().storage.tx(async (s) => {
          await s.memories.insert([memory(2)]);
          await s.memories.insert([memory(1)]);
        }),
        'DUPLICATE',
      );
      await expectCode(
        h().storage.tx((s) => s.memories.insert([memory(3, { characterId: fixedId(0x30, 99) })])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.memories.insert([memory(4, { eventId: fixedId(0x80, 99) })])),
        'NOT_FOUND',
      );
      expect(await h().storage.tx((s) => s.memories.listByCharacter(C.sarah))).toEqual([memory(1)]);
    });
  });
}
