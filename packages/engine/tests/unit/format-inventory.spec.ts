import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { DomainError } from '../../src/core/errors.js';
import { of } from '../../src/knowledge/index.js';
import {
  fakeItem,
  findItem,
  formatOf,
  giveItem,
  hideItem,
  pickUp,
  placeItem,
  projectInventory,
  searchLocation,
  searchProbability,
  showItem,
  stealItem,
  tradeItems,
  useItem,
  expireItems,
  type FormatOutput,
} from '../../src/formats/index.js';
import { A, DEF, L, LEA, S, T, formatKit, must, hears, sees } from '../helpers/format-kit.js';

const place = (
  kit: ReturnType<typeof formatKit>,
  defId: string,
  over: { hidden?: boolean; difficulty?: number; locationId?: string } = {},
) =>
  placeItem(kit.state, kit.fc, {
    itemDefId: defId,
    locationId: over.locationId ?? L.jardin,
    hidden: over.hidden ?? false,
    ...(over.difficulty !== undefined ? { difficulty: over.difficulty } : {}),
  });

const knownHolds = (kit: ReturnType<typeof formatKit>, who: string) =>
  of(kit.state, who).filter((k) => k.fact.predicate === 'holds');

describe('InventoryService : possession unique', () => {
  it('un objet posé a un lieu et pas de porteur ; l’y trouver donne un porteur et plus de lieu', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace, { hidden: true, difficulty: 75 });
    expect([item.holderId, item.locationId, item.hidden, item.searchDifficulty]).toEqual([null, L.jardin, true, 75]);
    const found = findItem(kit.state, kit.fc, { actorId: LEA, itemId: item.id });
    expect([found.item.holderId, found.item.locationId, found.item.hidden]).toEqual([LEA, null, false]);
    expect(found.event.type).toBe('item_found');
    expect(found.effects).toEqual([
      expect.objectContaining({
        targetKind: 'item',
        characterId: LEA,
        dimension: 'holder',
        reason: item.id,
        eventId: found.event.id,
      }),
    ]);
  });

  it('un objet caché ne se ramasse pas ; un objet visible oui, mais seulement sur le lieu de l’acteur', () => {
    const kit = formatKit();
    const hidden = place(kit, DEF.necklace, { hidden: true }).item;
    const visible = place(kit, DEF.ration).item;
    expect(() => pickUp(kit.state, kit.fc, { actorId: A, itemId: hidden.id })).toThrow(/caché/);
    kit.state.positions[A] = { kind: 'at', locationId: L.salon, zoneId: null };
    expect(() => pickUp(kit.state, kit.fc, { actorId: A, itemId: visible.id })).toThrow(DomainError);
    kit.state.positions[A] = { kind: 'at', locationId: L.jardin, zoneId: null };
    expect(pickUp(kit.state, kit.fc, { actorId: A, itemId: visible.id }).event.type).toBe('item_picked_up');
  });

  it('on ne donne, vole ni échange que ce qu’on possède ; une erreur ne modifie rien', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.ration);
    pickUp(kit.state, kit.fc, { actorId: A, itemId: item.id });
    const before = structuredClone(formatOf(kit.state));
    const seq = kit.state.nextEventSeq;
    expect(() => giveItem(kit.state, kit.fc, { fromId: S, toId: T, itemId: item.id })).toThrow(/ne possède pas/);
    expect(() => stealItem(kit.state, kit.fc, { fromId: S, toId: T, itemId: item.id, detected: false })).toThrow(
      DomainError,
    );
    expect(() => giveItem(kit.state, kit.fc, { fromId: A, toId: A, itemId: item.id })).toThrow(/identiques/);
    expect(() => giveItem(kit.state, kit.fc, { fromId: A, toId: 'inconnu', itemId: item.id })).toThrow(DomainError);
    expect(formatOf(kit.state)).toEqual(before);
    expect(kit.state.nextEventSeq).toBe(seq);
  });

  it('un objet non transférable ne se donne ni ne se vole', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.statue);
    pickUp(kit.state, kit.fc, { actorId: A, itemId: item.id });
    expect(() => giveItem(kit.state, kit.fc, { fromId: A, toId: S, itemId: item.id })).toThrow(/transférable/);
    expect(() => stealItem(kit.state, kit.fc, { fromId: A, toId: S, itemId: item.id, detected: true })).toThrow(
      /transférable/,
    );
  });

  it('cacher un objet porté le remet sur un lieu, caché ; le cacheur sait où', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.ration);
    pickUp(kit.state, kit.fc, { actorId: A, itemId: item.id });
    const hidden = hideItem(kit.state, kit.fc, { actorId: A, itemId: item.id, difficulty: 30 });
    expect([hidden.item.holderId, hidden.item.locationId, hidden.item.hidden, hidden.item.searchDifficulty]).toEqual([
      null,
      L.jardin,
      true,
      30,
    ]);
    expect(of(kit.state, A).some((k) => k.fact.predicate === 'item_at')).toBe(true);
    expect(of(kit.state, S).some((k) => k.fact.predicate === 'item_at')).toBe(false);
  });

  it('un troc échange deux objets atomiquement', () => {
    const kit = formatKit();
    const a = place(kit, DEF.ration).item;
    const b = place(kit, DEF.necklace).item;
    pickUp(kit.state, kit.fc, { actorId: A, itemId: a.id });
    pickUp(kit.state, kit.fc, { actorId: S, itemId: b.id });
    const traded = tradeItems(kit.state, kit.fc, {
      aId: A,
      bId: S,
      aItemId: a.id,
      bItemId: b.id,
      witnesses: hears(LEA),
    });
    expect([a.holderId, b.holderId]).toEqual([S, A]);
    expect(traded.events.map((e) => e.type)).toEqual(['item_traded', 'item_traded']);
    expect(() => tradeItems(kit.state, kit.fc, { aId: A, bId: S, aItemId: a.id, bItemId: b.id })).toThrow(DomainError);
    expect([a.holderId, b.holderId]).toEqual([S, A]);
  });
});

describe('InventoryService : la possession est une connaissance', () => {
  it('le porteur et les témoins qui entendent le savent ; ceux qui voient seulement, non', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace, { hidden: true });
    findItem(kit.state, kit.fc, { actorId: LEA, itemId: item.id, witnesses: [...hears(S), ...sees(T)] });
    const lea = knownHolds(kit, LEA);
    expect(lea).toHaveLength(1);
    expect(lea[0]?.fact).toMatchObject({
      subjectId: LEA,
      predicate: 'holds',
      objectText: `item:${item.id}`,
      isTrue: true,
      sensitivity: 3,
    });
    expect(lea[0]?.knowledge).toMatchObject({ sourceType: 'witnessed', confidence: 1, belief: 'believes' });
    expect(knownHolds(kit, S)).toHaveLength(1);
    expect(knownHolds(kit, T)).toEqual([]);
    expect(knownHolds(kit, A)).toEqual([]);
  });

  it('un vol non détecté ne crée aucune connaissance chez la victime ni chez les témoins', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace);
    pickUp(kit.state, kit.fc, { actorId: LEA, itemId: item.id });
    const stolen = stealItem(kit.state, kit.fc, {
      fromId: LEA,
      toId: T,
      itemId: item.id,
      detected: false,
      witnesses: hears(S),
    });
    expect(item.holderId).toBe(T);
    // Le voleur sait ; la victime n’apprend rien de nouveau (elle croit toujours détenir l’objet) ; les témoins non plus.
    expect(knownHolds(kit, T).map((k) => k.fact.subjectId)).toEqual([T]);
    expect(knownHolds(kit, LEA).map((k) => k.fact.subjectId)).toEqual([LEA]);
    expect(knownHolds(kit, S)).toEqual([]);
    expect(stolen.event.payload).toMatchObject({ detected: false, from: LEA, to: T });
    // La victime ne figure même pas parmi les participants de l’événement.
    expect(stolen.event.participants).toEqual([{ characterId: T, role: 'actor' }]);
  });

  it('un vol détecté apprend à la victime et aux témoins qui entendent qui détient l’objet', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace);
    pickUp(kit.state, kit.fc, { actorId: LEA, itemId: item.id });
    stealItem(kit.state, kit.fc, {
      fromId: LEA,
      toId: T,
      itemId: item.id,
      detected: true,
      witnesses: [...hears(S), ...sees(A)],
    });
    const toldThomas = (who: string) => knownHolds(kit, who).filter((k) => k.fact.subjectId === T);
    expect(toldThomas(LEA)).toHaveLength(1);
    expect(toldThomas(S)).toHaveLength(1);
    expect(toldThomas(A)).toEqual([]);
  });

  it('un faux objet crée un fait vrai sur le faux et un fait faux « holds(porteur, vrai collier) » inventé', () => {
    const kit = formatKit();
    const { item, facts, knowledge } = fakeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, actorId: T });
    expect(item).toMatchObject({ isFake: true, fakeOfItemDefId: DEF.necklace, holderId: T, itemDefId: DEF.necklace });
    const [truth, lie] = facts;
    expect(truth).toMatchObject({ subjectId: T, predicate: 'holds', objectText: `item:${item.id}`, isTrue: true });
    expect(lie).toMatchObject({
      subjectId: T,
      predicate: 'holds',
      objectText: 'item_def:immunity_necklace',
      isTrue: false,
      inventedById: T,
    });
    // L’inventeur sait que c’est faux.
    expect(knowledge.find((k) => k.factId === lie?.id)).toMatchObject({ characterId: T, belief: 'disbelieves' });
    expect(knownHolds(kit, S)).toEqual([]);
  });

  it('montrer un faux collier fait croire aux spectateurs que le porteur a le vrai (confiance selon la confiance accordée)', () => {
    const kit = formatKit();
    const { item } = fakeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, actorId: T });
    const shown = showItem(kit.state, kit.fc, { actorId: T, itemId: item.id, viewers: [...hears(S, LEA), ...sees(A)] });
    expect(shown.events[0]?.type).toBe('item_shown');
    const believed = knownHolds(kit, S).find((k) => k.fact.objectText === 'item_def:immunity_necklace');
    expect(believed?.fact.isTrue).toBe(false);
    expect(believed?.knowledge).toMatchObject({ sourceType: 'told', toldById: T });
    expect(knownHolds(kit, A)).toEqual([]);
  });

  it('montrer un vrai objet fait constater la possession, sans fausse piste', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace);
    pickUp(kit.state, kit.fc, { actorId: LEA, itemId: item.id });
    showItem(kit.state, kit.fc, { actorId: LEA, itemId: item.id, viewers: hears(S) });
    const seen = knownHolds(kit, S);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.fact.isTrue).toBe(true);
    expect(seen[0]?.knowledge.sourceType).toBe('witnessed');
  });
});

describe('InventoryService : usage et péremption', () => {
  it('le vrai collier est consommé après usage et produit ses effets de définition', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace);
    pickUp(kit.state, kit.fc, { actorId: LEA, itemId: item.id });
    const used = useItem(kit.state, kit.fc, { actorId: LEA, itemId: item.id });
    expect(used.worked).toBe(true);
    expect(used.defEffects).toMatchObject({ nullify_votes_against_holder: true });
    expect(item.state).toBe('used');
    expect(() => useItem(kit.state, kit.fc, { actorId: LEA, itemId: item.id })).toThrow(/used/);
  });

  it('un faux collier ne fait rien mais est consommé', () => {
    const kit = formatKit();
    const { item } = fakeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, actorId: T });
    const used = useItem(kit.state, kit.fc, { actorId: T, itemId: item.id });
    expect([used.worked, used.defEffects, item.state]).toEqual([false, {}, 'used']);
  });

  it('les objets dont la définition a expiré passent à « expired »', () => {
    const kit = formatKit(5, 0);
    const fs = formatOf(kit.state);
    fs.itemDefs[DEF.ration] = { ...must(fs.itemDefs[DEF.ration]), expiresAfterEpoch: 4 };
    const old = place(kit, DEF.ration).item;
    const fresh = place(kit, DEF.necklace).item;
    const out = expireItems(kit.state, kit.fc);
    expect([old.state, fresh.state]).toEqual(['expired', 'active']);
    expect(out.events.map((e) => e.type)).toEqual(['item_expired']);
    expect(expireItems(kit.state, kit.fc).events).toEqual([]);
  });
});

describe('InventoryService : fouille', () => {
  it('P(found) = σ(énergie + perspicacité − 3·difficulté + indices − 0,3·fouilles)', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace, { hidden: true, difficulty: 75 });
    must(kit.state.characters[LEA]).stats.energy = 80;
    const p = searchProbability(kit.state, LEA, item, 0);
    expect(p).toBeCloseTo(1 / (1 + Math.exp(-(0.8 + 0.5 - 3 * 0.75))), 12);
    expect(p).toBeCloseTo(0.28, 2);
    expect(searchProbability(kit.state, LEA, item, 3)).toBeLessThan(p);
    const lea = must(kit.state.characters[LEA]);
    kit.state.characters[LEA] = { ...lea, traits: { ...lea.traits, insight: 100 } };
    expect(searchProbability(kit.state, LEA, item, 0)).toBeGreaterThan(p);
  });

  it('le tirage décide : tirage sous P = found, au-dessus = not_found ; chaque fouille est historisée', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace, { hidden: true, difficulty: 75 });
    const rig = (draw: number) => ({ next: () => draw }) as unknown as Rng;
    const miss = searchLocation(kit.state, kit.fc, { actorId: LEA, locationId: L.jardin, rng: rig(0.99) });
    expect([miss.outcome, miss.itemId, item.holderId]).toEqual(['not_found', null, null]);
    expect(miss.events).toEqual([]);
    const hit = searchLocation(kit.state, kit.fc, {
      actorId: LEA,
      locationId: L.jardin,
      rng: rig(0.01),
      witnesses: hears(S),
    });
    expect([hit.outcome, hit.itemId, item.holderId]).toEqual(['found', item.id, LEA]);
    expect(hit.draw).toBe(0.01);
    expect(hit.events.map((e) => e.type)).toEqual(['item_found']);
    expect(formatOf(kit.state).actionLog.filter((r) => r.action === 'search')).toHaveLength(2);
    // Plus rien à trouver.
    expect(searchLocation(kit.state, kit.fc, { actorId: S, locationId: L.jardin, rng: rig(0) }).outcome).toBe(
      'not_found',
    );
  });

  it('fouiller plusieurs fois le même lieu diminue les chances', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.necklace, { hidden: true, difficulty: 40 });
    const never = { next: () => 0.9999 } as unknown as Rng;
    const p1 = searchLocation(kit.state, kit.fc, { actorId: LEA, locationId: L.jardin, rng: never }).probability;
    const p2 = searchLocation(kit.state, kit.fc, { actorId: LEA, locationId: L.jardin, rng: never }).probability;
    expect(p2).toBeLessThan(p1);
    expect(item.holderId).toBeNull();
  });

  it('trouver un indice (found_clue) révèle où est l’objet qu’il désigne, et augmente ensuite P(found)', () => {
    const kit = formatKit();
    const main = place(kit, DEF.necklace, { hidden: true, difficulty: 75, locationId: L.salon }).item;
    const clue = place(kit, DEF.clue, { hidden: true, difficulty: 10 }).item;
    const before = searchProbability(kit.state, LEA, main, 0);
    // Au jardin, il n’y a que l’indice : le tirage le trouve, pas l’objet principal.
    const r = searchLocation(kit.state, kit.fc, {
      actorId: LEA,
      locationId: L.jardin,
      rng: { next: () => 0 } as unknown as Rng,
    });
    expect([r.outcome, r.itemId, clue.holderId]).toEqual(['found_clue', clue.id, LEA]);
    const learned = of(kit.state, LEA).find((k) => k.fact.predicate === 'item_at');
    expect(learned?.fact.objectText).toBe(`item:${main.id}@${L.salon}`);
    expect(searchProbability(kit.state, LEA, main, 0)).toBeGreaterThan(before);
    // Les autres ne savent rien.
    expect(of(kit.state, S).some((k) => k.fact.predicate === 'item_at')).toBe(false);
  });

  it('même graine, même résultat (déterminisme)', () => {
    const run = () => {
      const kit = formatKit();
      place(kit, DEF.necklace, { hidden: true, difficulty: 20 });
      const rng = Rng.derive('graine', 3, 8, LEA);
      return searchLocation(kit.state, kit.fc, { actorId: LEA, locationId: L.jardin, rng });
    };
    const a = run();
    const b = run();
    expect([a.outcome, a.probability, a.draw]).toEqual([b.outcome, b.probability, b.draw]);
  });
});

describe('InventoryService : événements et projection', () => {
  it('l’inventaire rejoué depuis les events égale l’inventaire projeté (scénario de la chasse)', () => {
    const kit = formatKit();
    const all: FormatOutput[] = [];
    const necklace = place(kit, DEF.necklace, { hidden: true });
    all.push(necklace);
    all.push(findItem(kit.state, kit.fc, { actorId: LEA, itemId: necklace.item.id }));
    all.push(giveItem(kit.state, kit.fc, { fromId: LEA, toId: S, itemId: necklace.item.id }));
    all.push(stealItem(kit.state, kit.fc, { fromId: S, toId: T, itemId: necklace.item.id, detected: false }));
    all.push(hideItem(kit.state, kit.fc, { actorId: T, itemId: necklace.item.id, locationId: L.salon }));
    const fake = fakeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, actorId: A });
    all.push(fake);
    all.push(useItem(kit.state, kit.fc, { actorId: A, itemId: fake.item.id }));
    const replayed = projectInventory(all.flatMap((o) => o.events));
    const projected = Object.fromEntries(
      Object.values(formatOf(kit.state).items).map((i) => [
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
  });

  it('chaque event a un seq croissant et chaque changement d’emplacement un effet « item »', () => {
    const kit = formatKit();
    const { item } = place(kit, DEF.ration);
    const out = [
      pickUp(kit.state, kit.fc, { actorId: A, itemId: item.id }),
      giveItem(kit.state, kit.fc, { fromId: A, toId: S, itemId: item.id }),
    ];
    const seqs = out.flatMap((o) => o.events.map((e) => e.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const o of out) {
      expect(o.effects.every((e) => e.targetKind === 'item' && e.eventId === o.events[0]?.id)).toBe(true);
    }
  });
});
