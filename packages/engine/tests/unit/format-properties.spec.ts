import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/core/errors.js';
import { Rng } from '../../src/core/rng.js';
import {
  DEFAULT_VOTE_RULES,
  type FormatOutput,
  decide,
  expireItems,
  fakeItem,
  findItem,
  formatOf,
  giveItem,
  hideItem,
  pickUp,
  placeItem,
  projectInventory,
  searchLocation,
  showItem,
  stealItem,
  tradeItems,
  useItem,
} from '../../src/formats/index.js';
import { A, DEF, L, LEA, S, T, formatKit, must, hears } from '../helpers/format-kit.js';

const CHARS = [A, S, LEA, T];
const PLACES = [L.jardin, L.salon, L.cuisine];
const DEFS = [DEF.necklace, DEF.clue, DEF.ration, DEF.statue];

type Op =
  | { op: 'place'; def: number; place: number; hidden: boolean }
  | { op: 'find' | 'pickUp' | 'use' | 'show'; who: number; item: number }
  | { op: 'give' | 'steal'; from: number; to: number; item: number; detected: boolean }
  | { op: 'trade'; a: number; b: number; itemA: number; itemB: number }
  | { op: 'hide'; who: number; item: number; place: number }
  | { op: 'fake'; who: number; def: number }
  | { op: 'search'; who: number; place: number; draw: number }
  | { op: 'expire'; tick: number };

const idx = (max: number) => fc.nat({ max });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('place' as const), def: idx(3), place: idx(2), hidden: fc.boolean() }),
  fc.record({
    op: fc.constantFrom('find' as const, 'pickUp' as const, 'use' as const, 'show' as const),
    who: idx(3),
    item: idx(20),
  }),
  fc.record({
    op: fc.constantFrom('give' as const, 'steal' as const),
    from: idx(3),
    to: idx(3),
    item: idx(20),
    detected: fc.boolean(),
  }),
  fc.record({ op: fc.constant('trade' as const), a: idx(3), b: idx(3), itemA: idx(20), itemB: idx(20) }),
  fc.record({ op: fc.constant('hide' as const), who: idx(3), item: idx(20), place: idx(2) }),
  fc.record({ op: fc.constant('fake' as const), who: idx(3), def: idx(3) }),
  fc.record({
    op: fc.constant('search' as const),
    who: idx(3),
    place: idx(2),
    draw: fc.double({ min: 0, max: 0.999, noNaN: true }),
  }),
  fc.record({ op: fc.constant('expire' as const), tick: idx(9) }),
);

/** Exécute une suite d'opérations ; une opération invalide est refusée sans rien modifier. */
function run(ops: readonly Op[]) {
  const kit = formatKit(3, 8);
  const fs = formatOf(kit.state);
  fs.itemDefs[DEF.ration] = { ...must(fs.itemDefs[DEF.ration]), expiresAfterEpoch: 4 };
  const outputs: FormatOutput[] = [];
  let refused = 0;
  const itemId = (n: number): string => {
    const ids = Object.keys(fs.items).sort();
    return ids.length === 0 ? 'aucun' : (ids[n % ids.length] as string);
  };
  for (const op of ops) {
    const before = structuredClone({
      fs,
      seq: kit.state.nextEventSeq,
      facts: kit.state.facts,
      knowledge: kit.state.knowledge,
    });
    try {
      switch (op.op) {
        case 'place':
          outputs.push(
            placeItem(kit.state, kit.fc, {
              itemDefId: DEFS[op.def] as string,
              locationId: PLACES[op.place] as string,
              hidden: op.hidden,
            }),
          );
          break;
        case 'find':
          outputs.push(findItem(kit.state, kit.fc, { actorId: CHARS[op.who] as string, itemId: itemId(op.item) }));
          break;
        case 'pickUp':
          outputs.push(pickUp(kit.state, kit.fc, { actorId: CHARS[op.who] as string, itemId: itemId(op.item) }));
          break;
        case 'use':
          outputs.push(useItem(kit.state, kit.fc, { actorId: CHARS[op.who] as string, itemId: itemId(op.item) }));
          break;
        case 'show':
          outputs.push(
            showItem(kit.state, kit.fc, {
              actorId: CHARS[op.who] as string,
              itemId: itemId(op.item),
              viewers: hears(...CHARS),
            }),
          );
          break;
        case 'give':
          outputs.push(
            giveItem(kit.state, kit.fc, {
              fromId: CHARS[op.from] as string,
              toId: CHARS[op.to] as string,
              itemId: itemId(op.item),
            }),
          );
          break;
        case 'steal':
          outputs.push(
            stealItem(kit.state, kit.fc, {
              fromId: CHARS[op.from] as string,
              toId: CHARS[op.to] as string,
              itemId: itemId(op.item),
              detected: op.detected,
              witnesses: hears(...CHARS),
            }),
          );
          break;
        case 'trade':
          outputs.push(
            tradeItems(kit.state, kit.fc, {
              aId: CHARS[op.a] as string,
              bId: CHARS[op.b] as string,
              aItemId: itemId(op.itemA),
              bItemId: itemId(op.itemB),
            }),
          );
          break;
        case 'hide':
          outputs.push(
            hideItem(kit.state, kit.fc, {
              actorId: CHARS[op.who] as string,
              itemId: itemId(op.item),
              locationId: PLACES[op.place] as string,
            }),
          );
          break;
        case 'fake':
          outputs.push(
            fakeItem(kit.state, kit.fc, { itemDefId: DEFS[op.def] as string, actorId: CHARS[op.who] as string }),
          );
          break;
        case 'search':
          outputs.push(
            searchLocation(kit.state, kit.fc, {
              actorId: CHARS[op.who] as string,
              locationId: PLACES[op.place] as string,
              rng: { next: () => op.draw } as unknown as Rng,
            }),
          );
          break;
        case 'expire':
          outputs.push(expireItems(kit.state, kit.at(3 + (op.tick % 4), 0)));
          break;
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      refused += 1;
      // Atomicité : une opération refusée ne laisse aucune trace.
      expect({ fs, seq: kit.state.nextEventSeq, facts: kit.state.facts, knowledge: kit.state.knowledge }).toEqual(
        before,
      );
    }
  }
  return { kit, fs, outputs, refused };
}

describe('propriétés : inventaire', () => {
  it('l’inventaire projeté égale l’inventaire rejoué depuis les events', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const { fs, outputs } = run(ops);
        const replayed = projectInventory(outputs.flatMap((o) => o.events));
        const projected = Object.fromEntries(
          Object.values(fs.items).map((i) => [
            i.id,
            {
              itemDefId: i.itemDefId,
              holderId: i.holderId,
              locationId: i.locationId,
              hidden: i.hidden,
              state: i.state,
              isFake: i.isFake,
            },
          ]),
        );
        expect(replayed).toEqual(projected);
      }),
      { numRuns: 200 },
    );
  });

  it('aucun objet ne disparaît ni n’est dupliqué ; chaque objet a exactement un emplacement', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const { fs, outputs } = run(ops);
        const events = outputs.flatMap((o) => o.events);
        const created = events.filter((e) => e.type === 'item_placed' || e.type === 'item_faked');
        const ids = created.map((e) => e.payload['itemId']);
        expect(new Set(ids).size).toBe(ids.length);
        expect(Object.keys(fs.items).sort()).toEqual([...ids].sort());
        for (const item of Object.values(fs.items)) {
          expect((item.holderId === null) !== (item.locationId === null)).toBe(true);
          expect(item.hidden && item.holderId !== null).toBe(false);
        }
        // Les événements sont uniques et leur seq strictement croissant.
        const seqs = events.map((e) => e.seq);
        expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(seqs).size).toBe(seqs.length);
      }),
      { numRuns: 200 },
    );
  });

  it('chaque fait « holds » vrai nomme un porteur existant et un objet existant ; la possession ne fuit pas', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const { kit, fs } = run(ops);
        for (const fact of Object.values(kit.state.facts)) {
          if (fact.predicate !== 'holds' || !fact.isTrue || !fact.objectText?.startsWith('item:')) continue;
          expect(fs.items[fact.objectText.slice(5)]).toBeDefined();
          expect(kit.state.characters[fact.subjectId as string]).toBeDefined();
        }
        // Un faux fait (inventé) a toujours un inventeur qui est son sujet.
        for (const fact of Object.values(kit.state.facts)) {
          if (!fact.isTrue) expect(fact.inventedById).toBe(fact.subjectId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('la suite est déterministe : mêmes opérations, mêmes événements', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        const a = run(ops).outputs.flatMap((o) => o.events);
        const b = run(ops).outputs.flatMap((o) => o.events);
        expect(a).toEqual(b);
      }),
      { numRuns: 50 },
    );
  });
});

describe('propriétés : décompte', () => {
  it('l’éliminé a le maximum de voix ; une égalité en tête n’est jamais décidée sans tirage ni dernier tour', () => {
    const counts = fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), fc.nat({ max: 5 }));
    fc.assert(
      fc.property(
        counts,
        fc.constantFrom('revote', 'random', 'none' as const),
        fc.integer({ min: 1, max: 3 }),
        (c, tie, round) => {
          const rules = { ...DEFAULT_VOTE_RULES, tie, round, maxRounds: 3 };
          const result = decide(c, rules, [], Rng.derive('p', 1));
          const positive = Object.entries(c).filter(([, n]) => n > 0);
          if (positive.length === 0) {
            expect(result.status).toBe('no_votes');
            return;
          }
          const top = Math.max(...positive.map(([, n]) => n));
          const leaders = positive.filter(([, n]) => n === top).map(([id]) => id);
          if (leaders.length === 1) expect(result.eliminated).toBe(leaders[0]);
          else if (result.eliminated !== null) expect(leaders).toContain(result.eliminated);
          if (leaders.length > 1 && tie === 'none') expect(result.eliminated).toBeNull();
          if (leaders.length > 1 && tie === 'revote' && round < 3) expect(result.needsRevote).toBe(true);
          expect([...result.tied].sort()).toEqual([...leaders].sort());
        },
      ),
      { numRuns: 300 },
    );
  });
});
