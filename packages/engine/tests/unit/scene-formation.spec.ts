import { describe, expect, it } from 'vitest';
import { IDS, aSimState } from '@ai-reality/testkit';
import { formScenes, presenceRole } from '../../src/scene/formation.js';
import type { SceneRecord } from '../../src/state/journal.js';
import type { Id, SimState } from '../../src/state/types.js';

const { alexandre: A, sarah: S, lea: LEA, thomas: T } = IDS.characters;
const { cuisine, jardin, salon } = IDS.locations;
const { banc, piscine } = IDS.zones;

const at = (state: SimState, id: Id, locationId: Id, zoneId: Id | null = null) => {
  state.positions[id] = { kind: 'at', locationId, zoneId };
};
const counter = () => {
  let n = 0;
  return () => `scene-${String(++n)}`;
};
const open = (id: string, locationId: Id, zoneId: Id | null = null, tickStart = 0): SceneRecord => ({
  id,
  epochId: 'e',
  locationId,
  zoneId,
  kind: 'free',
  tickStart,
  tickEnd: null,
});

describe('formScenes', () => {
  it('deux personnages au même lieu : une seule scène', () => {
    const state = aSimState((s) => {
      at(s, A, cuisine);
      at(s, S, cuisine);
    });
    const f = formScenes({ state, epochId: 'e', tick: 0, openScenes: [], newId: counter() });
    expect(f.opened).toHaveLength(1);
    expect(f.assignments.get(A)?.sceneId).toBe(f.assignments.get(S)?.sceneId);
    expect(f.closed).toEqual([]);
  });

  it('un personnage seul a sa scène ; deux lieux, deux scènes', () => {
    const state = aSimState((s) => {
      at(s, A, cuisine);
      at(s, S, salon);
    });
    const f = formScenes({ state, epochId: 'e', tick: 3, openScenes: [], newId: counter() });
    expect(f.opened.map((sc) => [sc.locationId, sc.tickStart])).toEqual([
      [cuisine, 3],
      [salon, 3],
    ]);
  });

  it("arrivée en cours : la scène ouverte est conservée, rien n'est ouvert ni fermé", () => {
    const state = aSimState((s) => {
      at(s, A, cuisine);
      at(s, S, cuisine);
      at(s, LEA, cuisine);
    });
    const existing = open('S1', cuisine);
    const f = formScenes({ state, epochId: 'e', tick: 2, openScenes: [existing], newId: counter() });
    expect(f.opened).toEqual([]);
    expect(f.closed).toEqual([]);
    expect(f.assignments.get(LEA)).toEqual({ sceneId: 'S1', role: 'participant' });
  });

  it("une scène vide se ferme ; si quelqu'un arrive au même tick qu'un départ, elle reste ouverte", () => {
    const empty = aSimState((s) => {
      at(s, A, salon);
    });
    expect(
      formScenes({ state: empty, epochId: 'e', tick: 5, openScenes: [open('S1', cuisine)], newId: counter() }).closed,
    ).toEqual(['S1']);

    const relay = aSimState((s) => {
      at(s, S, cuisine);
    });
    const f = formScenes({ state: relay, epochId: 'e', tick: 5, openScenes: [open('S1', cuisine)], newId: counter() });
    expect(f.closed).toEqual([]);
    expect(f.opened).toEqual([]);
  });

  it("zone de la scène : celle du plus petit identifiant à l'ouverture ; les autres zones observent", () => {
    const state = aSimState((s) => {
      at(s, T, jardin, piscine);
      at(s, A, jardin, banc);
      at(s, S, jardin, banc);
    });
    const f = formScenes({ state, epochId: 'e', tick: 0, openScenes: [], newId: counter() });
    expect(f.opened[0]?.zoneId).toBe(banc);
    expect(f.assignments.get(A)?.role).toBe('participant');
    expect(f.assignments.get(S)?.role).toBe('participant');
    expect(f.assignments.get(T)?.role).toBe('observer');
  });

  it('personnages en transit ou hors-jeu : aucune scène', () => {
    const state = aSimState((s) => {
      s.positions[A] = { kind: 'transit', fromLocationId: cuisine, toLocationId: salon, arrivalTick: 4 };
    });
    const f = formScenes({ state, epochId: 'e', tick: 1, openScenes: [], newId: counter() });
    expect(f.opened).toEqual([]);
    expect(f.assignments.size).toBe(0);
  });
});

describe('presenceRole', () => {
  it('lieu sans zones : participant ; sinon participant seulement dans la zone de la scène', () => {
    const state = aSimState();
    expect(presenceRole(state.locations[salon], null, null)).toBe('participant');
    expect(presenceRole(state.locations[jardin], banc, banc)).toBe('participant');
    expect(presenceRole(state.locations[jardin], banc, piscine)).toBe('observer');
    expect(presenceRole(state.locations[jardin], banc, null)).toBe('observer');
    expect(presenceRole(state.locations[jardin], null, null)).toBe('participant');
  });
});
