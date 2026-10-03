import { describe, expect, it } from 'vitest';
import { WorldSetupSchema } from '../../src/world/world-spec.js';

const valid = {
  world: { name: 'Maison', seed: 'graine' },
  locations: [
    { slug: 'cuisine', name: 'Cuisine', kind: 'kitchen' },
    {
      slug: 'jardin',
      name: 'Jardin',
      kind: 'garden',
      zones: [{ slug: 'banc' }, { slug: 'piscine', hearingRange: 'location' }],
    },
  ],
  routes: [{ from: 'cuisine', to: 'jardin', travelTicks: 2, bothWays: true }],
};

const issuesOf = (input: unknown): string => {
  const r = WorldSetupSchema.safeParse(input);
  return r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' | ');
};

describe('WorldSetupSchema', () => {
  it('accepte un monde valide et applique les valeurs par défaut', () => {
    const setup = WorldSetupSchema.parse(valid);
    expect(setup.season).toEqual({ number: 1, rules: {}, format: {} });
    expect(setup.world.config).toEqual({});
    expect(setup.locations[0]).toMatchObject({ capacity: null, isPrivate: false, visualRef: null, zones: [] });
    expect(setup.locations[1]?.zones).toEqual([
      { slug: 'banc', hearingRange: 'zone' },
      { slug: 'piscine', hearingRange: 'location' },
    ]);
  });

  it('rejette un monde sans lieu', () => {
    expect(issuesOf({ ...valid, locations: [] })).toContain('locations');
  });

  it('rejette un slug de lieu en double', () => {
    const locations = [valid.locations[0], valid.locations[0]];
    expect(issuesOf({ ...valid, locations })).toContain('slug en double');
  });

  it('rejette une route vers un lieu inconnu, vers soi-même, ou de durée nulle', () => {
    expect(issuesOf({ ...valid, routes: [{ from: 'cuisine', to: 'cave', travelTicks: 1 }] })).toContain(
      'lieu inconnu « cave »',
    );
    expect(issuesOf({ ...valid, routes: [{ from: 'cuisine', to: 'cuisine', travelTicks: 1 }] })).toContain(
      'vers soi-même',
    );
    expect(issuesOf({ ...valid, routes: [{ from: 'cuisine', to: 'jardin', travelTicks: 0 }] })).toContain(
      'travelTicks',
    );
  });

  it('rejette une portée d’écoute inconnue et une configuration invalide', () => {
    const bad = {
      ...valid,
      locations: [{ slug: 'a', name: 'A', kind: 'k', zones: [{ slug: 'z', hearingRange: 'partout' }] }],
    };
    expect(issuesOf(bad)).toContain('hearingRange');
    expect(issuesOf({ ...valid, world: { ...valid.world, config: { ticksPerEpoch: 0 } } })).toContain('ticksPerEpoch');
  });

  it('accepte des règles de saison partielles et rejette un crédit initial négatif', () => {
    expect(
      WorldSetupSchema.safeParse({ ...valid, season: { rules: { economy: { startingCredits: 50 } } } }).success,
    ).toBe(true);
    expect(issuesOf({ ...valid, season: { rules: { economy: { startingCredits: -5 } } } })).toContain(
      'startingCredits',
    );
  });
});
