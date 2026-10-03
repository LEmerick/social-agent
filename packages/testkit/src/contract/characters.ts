import { describe, expect, it } from 'vitest';
import { defaultEdge, type CharacterRecord, type DirectiveRecord, type GoalRecord } from '@ai-reality/engine';
import { aCharacter, aWorld, seedWorld } from '../builders.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { type HarnessRef, expectCode } from './support.js';

const C = IDS.characters;
const ALEXANDRE: CharacterRecord = aCharacter('alexandre').build();

const directive = (rank: number, over: Partial<DirectiveRecord>): DirectiveRecord => ({
  id: fixedId(0x80, rank),
  characterId: C.alexandre,
  text: 'Rapproche-toi de Sarah.',
  fromEpoch: 1,
  toEpoch: null,
  biases: null,
  ...over,
});

export function charactersContract(h: HarnessRef): void {
  describe('personnages', () => {
    it('un personnage conserve ses traits, son identité et ses champs optionnels', async () => {
      await seedWorld(h().storage);
      expect(await h().storage.tx((s) => s.characters.findById(ALEXANDRE.id))).toEqual(ALEXANDRE);
      expect(await h().storage.tx((s) => s.characters.findById(fixedId(0x30, 200)))).toBeUndefined();
    });

    it('listByWorld est triée par slug et ne renvoie que le monde demandé', async () => {
      await seedWorld(h().storage);
      await h().storage.tx(async (s) => {
        await s.worlds.insert({ id: IDS.otherWorld, name: 'Autre', seed: 'x', config: {} });
        await s.characters.insert({ ...aCharacter('zoe').build(), worldId: IDS.otherWorld });
      });
      const list = await h().storage.tx((s) => s.characters.listByWorld(IDS.world));
      expect(list.map((c) => c.slug)).toEqual(['alexandre', 'lea', 'sarah', 'thomas']);
    });

    it('un slug déjà pris dans le même monde est rejeté (DUPLICATE) ; accepté dans un autre monde', async () => {
      await seedWorld(h().storage);
      await expectCode(
        h().storage.tx((s) => s.characters.insert({ ...ALEXANDRE, id: fixedId(0x30, 201) })),
        'DUPLICATE',
      );
      await h().storage.tx(async (s) => {
        await s.worlds.insert({ id: IDS.otherWorld, name: 'Autre', seed: 'x', config: {} });
        await s.characters.insert({ ...ALEXANDRE, id: fixedId(0x30, 202), worldId: IDS.otherWorld });
      });
      expect(await h().storage.tx((s) => s.characters.listByWorld(IDS.otherWorld))).toHaveLength(1);
    });

    it('un personnage rattaché à un monde inexistant est rejeté (NOT_FOUND)', async () => {
      await expectCode(
        h().storage.tx((s) => s.characters.insert(ALEXANDRE)),
        'NOT_FOUND',
      );
    });

    it('updateStatus change le statut ; personnage inconnu ⇒ NOT_FOUND', async () => {
      await seedWorld(h().storage);
      await h().storage.tx((s) => s.characters.updateStatus(C.thomas, 'eliminated'));
      expect((await h().storage.tx((s) => s.characters.findById(C.thomas)))?.status).toBe('eliminated');
      await expectCode(
        h().storage.tx((s) => s.characters.updateStatus(fixedId(0x30, 203), 'paused')),
        'NOT_FOUND',
      );
    });

    it('un personnage sans trait garde des traits vides', async () => {
      const nu = aCharacter('nu').build();
      await h().storage.tx(async (s) => {
        await s.worlds.insert(aWorld().build().world);
        await s.characters.insert(nu);
      });
      expect((await h().storage.tx((s) => s.characters.findById(nu.id)))?.traits).toEqual({});
    });
  });

  describe('objectifs', () => {
    it('les objectifs sont triés par personnage puis id, avec cible et époques', async () => {
      const fx = await seedWorld(h().storage);
      const goal: GoalRecord = {
        id: fixedId(0x40, 50),
        characterId: C.alexandre,
        kind: 'secondary',
        description: 'Séduire Sarah',
        origin: 'season',
        targetCharacterId: C.sarah,
        status: 'achieved',
        createdEpoch: 1,
        closedEpoch: 4,
      };
      await h().storage.tx((s) => s.goals.insert(goal));
      const list = await h().storage.tx((s) => s.goals.listByWorld(IDS.world));
      expect(list).toEqual(
        [...fx.goals, goal].sort((a, b) =>
          a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : a.id < b.id ? -1 : 1,
        ),
      );
    });

    it('upsert : insère un objectif absent, puis met à jour statut et clôture en conservant createdEpoch', async () => {
      const fx = await seedWorld(h().storage);
      const base = fx.goals[0];
      if (!base) throw new Error('fixture sans objectif');
      const fresh = {
        ...base,
        id: fixedId(0x40, 70),
        description: 'nouvel objectif',
        createdEpoch: 2,
        closedEpoch: null,
      };
      await h().storage.tx((s) => s.goals.upsert(fresh));
      await h().storage.tx((s) => s.goals.upsert({ ...fresh, status: 'achieved', createdEpoch: null, closedEpoch: 3 }));
      const found = (await h().storage.tx((s) => s.goals.listByWorld(IDS.world))).find((g) => g.id === fresh.id);
      expect(found).toEqual({ ...fresh, status: 'achieved', createdEpoch: 2, closedEpoch: 3 });
      await expectCode(
        h().storage.tx((s) => s.goals.upsert({ ...fresh, characterId: fixedId(0x30, 99) })),
        'NOT_FOUND',
      );
    });

    it('un objectif pour un personnage ou une cible inconnus est rejeté (NOT_FOUND) ; id en double ⇒ DUPLICATE', async () => {
      const fx = await seedWorld(h().storage);
      const base = fx.goals[0];
      if (!base) throw new Error('fixture sans objectif');
      await expectCode(
        h().storage.tx((s) => s.goals.insert({ ...base, id: fixedId(0x40, 60), characterId: fixedId(0x30, 99) })),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.goals.insert({ ...base, id: fixedId(0x40, 61), targetCharacterId: fixedId(0x30, 99) })),
        'NOT_FOUND',
      );
      await expectCode(
        h().storage.tx((s) => s.goals.insert(base)),
        'DUPLICATE',
      );
    });
  });

  describe('directives', () => {
    it('sans directive, current renvoie undefined', async () => {
      await seedWorld(h().storage);
      expect(await h().storage.tx((s) => s.directives.current(C.alexandre, 3))).toBeUndefined();
    });

    it('current renvoie la directive en vigueur à l’époque donnée (la plus récente, bornes comprises)', async () => {
      await seedWorld(h().storage);
      const biases = {
        actions: { flatter: 0.4 },
        targets: { [C.sarah]: 0.6 },
        prefer: ['talk_to'],
        forbid: ['threaten'],
      };
      const d1 = directive(1, { fromEpoch: 1, toEpoch: 5, text: 'ancienne' });
      const d2 = directive(2, { fromEpoch: 4, toEpoch: null, text: 'récente', biases });
      await h().storage.tx(async (s) => {
        await s.directives.insert(d1);
        await s.directives.insert(d2);
      });
      const at = (n: number) => h().storage.tx((s) => s.directives.current(C.alexandre, n));
      expect(await at(0)).toBeUndefined();
      expect(await at(1)).toEqual(d1);
      expect(await at(3)).toEqual(d1);
      expect(await at(4)).toEqual(d2);
      expect(await at(5)).toEqual(d2);
      expect(await at(99)).toEqual(d2);
    });

    it('une directive terminée n’est plus en vigueur ; personnage inconnu ⇒ NOT_FOUND', async () => {
      await seedWorld(h().storage);
      await h().storage.tx((s) => s.directives.insert(directive(1, { fromEpoch: 1, toEpoch: 2 })));
      expect(await h().storage.tx((s) => s.directives.current(C.alexandre, 3))).toBeUndefined();
      await expectCode(
        h().storage.tx((s) => s.directives.insert(directive(2, { characterId: fixedId(0x30, 99) }))),
        'NOT_FOUND',
      );
    });
  });

  describe('relations', () => {
    it('upsert crée puis met à jour (idempotent) ; la liste est triée source puis cible', async () => {
      const fx = await seedWorld(h().storage);
      const edge = {
        ...defaultEdge(C.thomas, C.alexandre),
        rivalry: 60,
        acquaintance: 'acquainted' as const,
        labels: ['rival'],
        extraAxes: { loyaute: 5 },
      };
      await h().storage.tx((s) => s.relationships.upsert(IDS.world, [edge]));
      await h().storage.tx((s) => s.relationships.upsert(IDS.world, [edge]));
      const updated = { ...edge, rivalry: 75, labels: ['rival', 'ennemi'], interactionCount: 3 };
      await h().storage.tx((s) => s.relationships.upsert(IDS.world, [updated]));
      const list = await h().storage.tx((s) => s.relationships.listByWorld(IDS.world));
      expect(list).toHaveLength(fx.relationships.length + 1);
      expect(list.find((r) => r.sourceId === C.thomas)).toEqual(updated);
      expect(list.map((r) => r.sourceId + r.targetId)).toEqual([...list.map((r) => r.sourceId + r.targetId)].sort());
    });

    it('les relations du monde Palmiers se relisent à l’identique', async () => {
      const fx = await seedWorld(h().storage, aWorld().build());
      expect(await h().storage.tx((s) => s.relationships.listByWorld(IDS.world))).toEqual(fx.relationships);
    });

    it('une relation avec un personnage inconnu est rejetée (NOT_FOUND)', async () => {
      await seedWorld(h().storage);
      await expectCode(
        h().storage.tx((s) => s.relationships.upsert(IDS.world, [defaultEdge(C.sarah, fixedId(0x30, 99))])),
        'NOT_FOUND',
      );
    });
  });
}
