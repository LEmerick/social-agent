/**
 * SimState « Palmiers » minimal pour les tests purs, identifiants en clair (`'alexandre'`, `'salon'`).
 * Les tests qui n'en dépendent pas utilisent la fixture du testkit : `palmiersFixture()` ci-dessous.
 */
import { IDS, aSimState } from '@ai-reality/testkit';
import { simIdFactory } from '../../src/core/sim-ids.js';
import type { IdFactory } from '../../src/core/id.js';
import type { SceneContext } from '../../src/rules/types.js';
import {
  DEFAULT_SEASON_RULES,
  DEFAULT_WORLD_CONFIG,
  type CharacterNode,
  type SeasonRules,
  type SimState,
} from '../../src/state/types.js';

export const TRAITS: Record<string, Record<string, number>> = {
  alexandre: {
    charisma: 85,
    ambition: 90,
    empathy: 35,
    loyalty: 40,
    impulsivity: 45,
    manipulation: 80,
    sociability: 75,
    competitiveness: 70,
  },
  sarah: {
    charisma: 60,
    ambition: 50,
    empathy: 65,
    loyalty: 75,
    impulsivity: 30,
    manipulation: 25,
    sociability: 70,
    competitiveness: 40,
  },
  lea: {
    charisma: 55,
    ambition: 45,
    empathy: 60,
    loyalty: 80,
    impulsivity: 40,
    manipulation: 30,
    sociability: 65,
    competitiveness: 35,
  },
  thomas: {
    charisma: 65,
    ambition: 70,
    empathy: 30,
    loyalty: 50,
    impulsivity: 65,
    manipulation: 40,
    sociability: 55,
    competitiveness: 85,
  },
};

export const SLUGS = ['alexandre', 'sarah', 'lea', 'thomas'] as const;
export const SALON = 'salon';

const node = (slug: string, traits: Record<string, number>): CharacterNode => ({
  id: slug,
  slug,
  firstName: slug,
  autonomy: 'autonomous',
  status: 'active',
  traits,
  stats: { energy: 100, morale: 60, popularity: 50, influence: 50, reputation: 50 },
  credits: 100,
  mood: {},
  scores: { social: 0, drama: 0, popularity: 0, survival: 0, influence: 0 },
  goals: [],
  directive: null,
  agenda: [],
  restrictedSinceEpoch: null,
});

export function palmiersState(
  opts: { rules?: Partial<SeasonRules>; traits?: Record<string, Record<string, number>>; seed?: string } = {},
): SimState {
  const rules: SeasonRules = { ...structuredClone(DEFAULT_SEASON_RULES), ...opts.rules };
  const traits = Object.fromEntries(SLUGS.map((s) => [s, { ...TRAITS[s], ...opts.traits?.[s] }]));
  return {
    world: { id: 'world', seed: opts.seed ?? 'palmiers-test', config: { ...DEFAULT_WORLD_CONFIG } },
    season: { id: 'season', number: 1, rulesVersion: 1, rules },
    epoch: { id: 'epoch-0', number: 0 },
    tick: 3,
    nextEventSeq: 1,
    characters: Object.fromEntries(SLUGS.map((s) => [s, node(s, { ...traits[s] })])),
    relationships: {},
    locations: {},
    routes: [
      { fromLocationId: SALON, toLocationId: 'jardin', travelTicks: 1 },
      { fromLocationId: 'jardin', toLocationId: SALON, travelTicks: 1 },
    ],
    facts: {},
    knowledge: {},
    positions: Object.fromEntries(SLUGS.map((s) => [s, { kind: 'at', locationId: SALON, zoneId: null } as const])),
    dailyCounts: {},
    ext: {},
  };
}

export const salonScene = (extra: Partial<SceneContext> = {}): SceneContext => ({
  members: SLUGS.map((s) => ({ characterId: s, locationId: SALON, zoneId: null })),
  ...extra,
});

export const idsFor = (state: SimState, stream = 'ids'): IdFactory =>
  simIdFactory(state.world.seed, state.world.config, state.epoch?.number ?? 0, state.tick, stream);

export const opt = (action: string, targetId: string | null = null, over: Record<string, string | null> = {}) => ({
  action,
  targetId,
  factId: null,
  itemId: null,
  locationId: null,
  ...over,
});

/** Les identifiants de la fixture du testkit, par prénom en minuscules. */
export const P = IDS.characters;

/**
 * La fixture du testkit (`aSimState()`) ramenée à ce que supposent les tests purs : aucune relation, aucun fait,
 * tout le monde au salon au tick 3 de l'époque 0. Remplace `palmiersState()` pour les tests qui lisent les personnages
 * par `P.alexandre`…
 */
export function palmiersFixture(
  opts: { rules?: Partial<SeasonRules>; traits?: Record<string, Record<string, number>>; seed?: string } = {},
): SimState {
  return aSimState((readonly) => {
    // Les états de test sont mutables : on lève seulement les `readonly` de surface du type de domaine.
    const state = readonly as unknown as {
      world: { seed: string };
      season: { rules: SeasonRules };
      epoch: { id: string; number: number };
      tick: number;
      relationships: Record<string, unknown>;
      facts: Record<string, unknown>;
      knowledge: Record<string, unknown>;
      characters: Record<string, { slug: string; traits: Record<string, number> }>;
      positions: Record<string, unknown>;
    };
    state.relationships = {};
    state.facts = {};
    state.knowledge = {};
    state.epoch = { id: 'epoch-0', number: 0 };
    state.tick = 3;
    if (opts.seed) state.world.seed = opts.seed;
    state.season.rules = { ...state.season.rules, ...opts.rules };
    for (const [id, character] of Object.entries(state.characters)) {
      character.traits = { ...character.traits, ...(opts.traits?.[id] ?? opts.traits?.[character.slug]) };
      state.positions[id] = { kind: 'at', locationId: IDS.locations.salon, zoneId: null };
    }
  });
}
