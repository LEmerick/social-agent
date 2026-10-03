import { describe, expect, it } from 'vitest';
import { IDS, aSimState } from '@ai-reality/testkit';
import { audience } from '../../src/scene/audience.js';
import type { Id, SimState } from '../../src/state/types.js';

const { alexandre: A, sarah: S, lea: LEA, thomas: T } = IDS.characters;
const { jardin, salon } = IDS.locations;
const { banc, piscine } = IDS.zones;

const at = (state: SimState, id: Id, locationId: Id, zoneId: Id | null = null) => {
  state.positions[id] = { kind: 'at', locationId, zoneId };
};

describe('audience', () => {
  it('lieu sans zones : tout le monde entend, quel que soit le volume', () => {
    const state = aSimState((s) => {
      at(s, A, salon);
      at(s, S, salon);
      at(s, LEA, salon);
    });
    for (const volume of ['whisper', 'normal', 'loud'] as const) {
      expect(audience(state, [A, S, LEA], A, volume)).toEqual([
        { characterId: S, perception: 'hears' },
        { characterId: LEA, perception: 'hears' },
      ]);
    }
  });

  it("un murmure n'est entendu que dans la zone ; l'observateur d'une autre zone voit sans entendre", () => {
    const state = aSimState((s) => {
      at(s, A, jardin, banc);
      at(s, S, jardin, banc);
      at(s, LEA, jardin, piscine);
    });
    expect(audience(state, [A, S, LEA], A, 'whisper')).toEqual([
      { characterId: S, perception: 'hears' },
      { characterId: LEA, perception: 'sees' },
    ]);
  });

  it('volume normal : une autre zone voit seulement ; fort : entend', () => {
    const state = aSimState((s) => {
      at(s, A, jardin, banc);
      at(s, LEA, jardin, piscine);
    });
    expect(audience(state, [A, LEA], A, 'normal')).toEqual([{ characterId: LEA, perception: 'sees' }]);
    expect(audience(state, [A, LEA], A, 'loud')).toEqual([{ characterId: LEA, perception: 'hears' }]);
  });

  it('zone du locuteur à portée `location` : volume normal entendu dans tout le lieu, murmure non', () => {
    const state = aSimState((s) => {
      const garden = s.locations[jardin];
      if (!garden) throw new Error('jardin absent');
      s.locations[jardin] = {
        ...garden,
        zones: garden.zones.map((z) => (z.id === banc ? { ...z, hearingRange: 'location' as const } : z)),
      };
      at(s, A, jardin, banc);
      at(s, LEA, jardin, piscine);
    });
    expect(audience(state, [A, LEA], A, 'normal')).toEqual([{ characterId: LEA, perception: 'hears' }]);
    expect(audience(state, [A, LEA], A, 'whisper')).toEqual([{ characterId: LEA, perception: 'sees' }]);
  });

  it("personne hors du lieu n'est dans l'audience (autre lieu, transit, hors-jeu)", () => {
    const state = aSimState((s) => {
      at(s, A, salon);
      at(s, S, jardin);
      s.positions[LEA] = { kind: 'transit', fromLocationId: salon, toLocationId: jardin, arrivalTick: 5 };
      s.positions[T] = { kind: 'offstage', reason: 'sleep', lastLocationId: salon };
    });
    expect(audience(state, [A, S, LEA, T], A, 'loud')).toEqual([]);
  });

  it("le locuteur n'entend pas lui-même ; un locuteur absent n'a pas d'audience", () => {
    const state = aSimState((s) => {
      at(s, A, salon);
      at(s, S, salon);
    });
    expect(audience(state, [A, S], S, 'normal').map((l) => l.characterId)).toEqual([A]);
    expect(audience(state, [A, S], T, 'normal')).toEqual([]);
  });
});
