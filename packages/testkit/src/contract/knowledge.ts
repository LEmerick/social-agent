import { describe, expect, it } from 'vitest';
import { seedWorld } from '../builders.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { SARAH_SECRET, chainOf4 } from './data.js';
import { type HarnessRef, expectCode } from './support.js';

const C = IDS.characters;

export function knowledgeContract(h: HarnessRef): void {
  describe('faits et connaissances', () => {
    it('les faits se relisent à l’identique, triés par id', async () => {
      await seedWorld(h().storage);
      const other = {
        ...SARAH_SECRET,
        id: fixedId(0x50, 9),
        predicate: 'rumeur',
        isTrue: false,
        inventedById: C.thomas,
        sensitivity: 1,
      };
      await h().storage.tx((s) => s.facts.insert(IDS.world, [other]));
      expect(await h().storage.tx((s) => s.facts.listByWorld(IDS.world))).toEqual([SARAH_SECRET, other]);
    });

    it('un fait en double est rejeté (DUPLICATE) ; monde inconnu ⇒ NOT_FOUND', async () => {
      await seedWorld(h().storage);
      await expectCode(
        h().storage.tx((s) => s.facts.insert(IDS.world, [SARAH_SECRET])),
        'DUPLICATE',
      );
      await expectCode(
        h().storage.tx((s) => s.facts.insert(IDS.otherWorld, [{ ...SARAH_SECRET, id: fixedId(0x50, 8) }])),
        'NOT_FOUND',
      );
    });

    it('une connaissance se relit à l’identique ; liste triée par personnage puis id', async () => {
      const fx = await seedWorld(h().storage);
      const chain = chainOf4(SARAH_SECRET.id);
      await h().storage.tx((s) => s.knowledge.insert(chain));
      const list = await h().storage.tx((s) => s.knowledge.listByWorld(IDS.world));
      const expected = [...fx.knowledge, ...chain].sort((a, b) =>
        a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : a.id < b.id ? -1 : 1,
      );
      expect(list).toEqual(expected);
    });

    it('une connaissance pour un personnage, un fait ou un parent inconnus est rejetée (NOT_FOUND)', async () => {
      await seedWorld(h().storage);
      const [first] = chainOf4(SARAH_SECRET.id);
      if (!first) throw new Error('chaîne vide');
      await expectCode(
        h().storage.tx((s) => s.knowledge.insert([{ ...first, characterId: fixedId(0x30, 99) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.knowledge.insert([{ ...first, factId: fixedId(0x50, 99) }])),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.knowledge.insert([{ ...first, parentKnowledgeId: fixedId(0x61, 99) }])),
        'NOT_FOUND',
      );
    });

    it('un identifiant de connaissance en double est rejeté (DUPLICATE)', async () => {
      await seedWorld(h().storage);
      const [first] = chainOf4(SARAH_SECRET.id);
      if (!first) throw new Error('chaîne vide');
      await h().storage.tx((s) => s.knowledge.insert([first]));
      await expectCode(
        h().storage.tx((s) => s.knowledge.insert([first])),
        'DUPLICATE',
      );
    });

    it('la provenance d’une chaîne de 4 maillons va de l’origine jusqu’au personnage', async () => {
      await seedWorld(h().storage);
      const chain = chainOf4(SARAH_SECRET.id);
      await h().storage.tx((s) => s.knowledge.insert(chain));

      const fromThomas = await h().storage.tx((s) => s.knowledge.provenance(C.thomas, SARAH_SECRET.id));
      expect(fromThomas).toEqual(chain);
      expect(fromThomas.map((k) => k.characterId)).toEqual([C.alexandre, C.sarah, C.lea, C.thomas]);
      expect(fromThomas.map((k) => k.toldById)).toEqual([null, C.alexandre, C.sarah, C.lea]);

      const fromLea = await h().storage.tx((s) => s.knowledge.provenance(C.lea, SARAH_SECRET.id));
      expect(fromLea.map((k) => k.characterId)).toEqual([C.alexandre, C.sarah, C.lea]);
    });

    it('la provenance d’un fait inconnu du personnage est vide ; un témoin direct a une chaîne d’un maillon', async () => {
      await seedWorld(h().storage);
      const chain = chainOf4(SARAH_SECRET.id);
      await h().storage.tx((s) => s.knowledge.insert(chain));
      expect(await h().storage.tx((s) => s.knowledge.provenance(C.thomas, fixedId(0x50, 99)))).toEqual([]);
      expect(await h().storage.tx((s) => s.knowledge.provenance(C.alexandre, SARAH_SECRET.id))).toEqual([chain[0]]);
    });
  });
}
