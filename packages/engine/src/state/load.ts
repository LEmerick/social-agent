import { DomainError } from '../core/errors.js';
import type { StoragePort, StorageTx } from '../ports/storage.js';
import type { CharacterStateRecord } from './journal.js';
import {
  type CharacterNode,
  type Goal,
  type Id,
  type LocationNode,
  type Position,
  type RelationshipEdge,
  type ScoreName,
  type SeasonRules,
  type SimState,
  type StatKey,
  DEFAULT_SEASON_RULES,
  DEFAULT_WORLD_CONFIG,
  SCORE_NAMES,
  STAT_KEYS,
  relKey,
  type WorldConfig,
} from './types.js';

/** Valeurs de départ d'un personnage qui n'a pas encore de ligne `character_state`. */
export const DEFAULT_STATS: Readonly<Record<StatKey, number>> = {
  energy: 100,
  morale: 60,
  popularity: 50,
  influence: 50,
  reputation: 50,
};

/** Fusionne des règles partielles (telles que stockées) avec les règles par défaut. */
export function mergeSeasonRules(stored: Readonly<Record<string, unknown>>): SeasonRules {
  const partial = stored as Partial<{
    economy: Partial<SeasonRules['economy']>;
    relationshipAxes: readonly string[];
    scoreWeights: Partial<SeasonRules['scoreWeights']>;
    enabledActions: readonly string[];
  }>;
  return {
    economy: { ...DEFAULT_SEASON_RULES.economy, ...partial.economy },
    relationshipAxes: partial.relationshipAxes ?? DEFAULT_SEASON_RULES.relationshipAxes,
    scoreWeights: { ...DEFAULT_SEASON_RULES.scoreWeights, ...partial.scoreWeights },
    enabledActions: partial.enabledActions ?? DEFAULT_SEASON_RULES.enabledActions,
  };
}

/** Configuration du monde : valeurs numériques connues, complétées par les défauts. */
export function mergeWorldConfig(stored: Readonly<Record<string, unknown>>): WorldConfig {
  const pick = (key: keyof WorldConfig): number => {
    const value = stored[key];
    return typeof value === 'number' ? value : DEFAULT_WORLD_CONFIG[key];
  };
  return {
    ticksPerEpoch: pick('ticksPerEpoch'),
    tickMinutes: pick('tickMinutes'),
    maxConversationTurns: pick('maxConversationTurns'),
    maxInteractionsPerScene: pick('maxInteractionsPerScene'),
    startMs: pick('startMs'),
  };
}

export interface LoadOptions {
  /**
   * Époque pour laquelle on cherche la directive en vigueur.
   * Par défaut : l'époque qui suit la dernière époque ayant un état, ou 0.
   */
  readonly epochNumber?: number;
}

/** Charge l'état complet d'une saison (ni époque ouverte, ni tick : `epoch = null`, `tick = 0`). */
export async function loadSimState(
  storage: StoragePort,
  worldId: Id,
  seasonNumber: number,
  options: LoadOptions = {},
): Promise<SimState> {
  return storage.tx((s) => load(s, worldId, seasonNumber, options));
}

async function load(s: StorageTx, worldId: Id, seasonNumber: number, options: LoadOptions): Promise<SimState> {
  const world = await s.worlds.findById(worldId);
  if (!world) throw new DomainError('NOT_FOUND', `Monde ${worldId} introuvable`);
  const season = await s.seasons.findByNumber(worldId, seasonNumber);
  if (!season)
    throw new DomainError('NOT_FOUND', `Saison ${String(seasonNumber)} introuvable dans le monde ${worldId}`);
  const rules = mergeSeasonRules(season.rules);

  const [locations, zones, routes, characters, goals, relationships, facts, knowledge, states, lastSeq] =
    await Promise.all([
      s.locations.listByWorld(worldId),
      s.zones.listByWorld(worldId),
      s.routes.listByWorld(worldId),
      s.characters.listByWorld(worldId),
      s.goals.listByWorld(worldId),
      s.relationships.listByWorld(worldId),
      s.facts.listByWorld(worldId),
      s.knowledge.listByWorld(worldId),
      s.characterStates.latest(worldId),
      s.journal.maxSeq(worldId),
    ]);

  const epochNumber = options.epochNumber ?? (await nextEpochNumber(s, states));
  const stateOf = new Map(states.map((st) => [st.characterId, st]));

  const nodes: Record<Id, CharacterNode> = {};
  const positions: Record<Id, Position> = {};
  for (const c of characters) {
    const st = stateOf.get(c.id);
    const directive = await s.directives.current(c.id, epochNumber);
    nodes[c.id] = {
      id: c.id,
      slug: c.slug,
      firstName: c.firstName,
      autonomy: c.autonomy,
      status: st?.status ?? c.status,
      traits: { ...c.traits },
      stats: statsOf(st),
      credits: st?.credits ?? rules.economy.startingCredits,
      mood: { ...st?.mood },
      scores: scoresOf(st),
      goals: goals.filter((g) => g.characterId === c.id).map(toGoal),
      directive: directive?.biases ?? null,
      agenda: [],
      restrictedSinceEpoch: null,
    };
    positions[c.id] = { kind: 'offstage', reason: 'initial', lastLocationId: null };
  }

  const zonesOf = new Map<Id, LocationNode['zones'][number][]>();
  for (const z of zones) {
    const list = zonesOf.get(z.locationId) ?? [];
    list.push({ id: z.id, slug: z.slug, hearingRange: z.hearingRange });
    zonesOf.set(z.locationId, list);
  }
  const locationNodes: Record<Id, LocationNode> = {};
  for (const l of locations) {
    locationNodes[l.id] = {
      id: l.id,
      slug: l.slug,
      name: l.name,
      kind: l.kind,
      capacity: l.capacity,
      isPrivate: l.isPrivate,
      zones: zonesOf.get(l.id) ?? [],
    };
  }

  const relationshipEdges: Record<string, RelationshipEdge> = {};
  for (const r of relationships) relationshipEdges[relKey(r.sourceId, r.targetId)] = r;

  return {
    world: { id: world.id, seed: world.seed, config: mergeWorldConfig(world.config) },
    season: { id: season.id, number: season.number, rulesVersion: season.rulesVersion, rules },
    epoch: null,
    tick: 0,
    nextEventSeq: lastSeq + 1,
    characters: nodes,
    relationships: relationshipEdges,
    locations: locationNodes,
    routes,
    facts: Object.fromEntries(facts.map((f) => [f.id, f])),
    knowledge: Object.fromEntries(knowledge.map((k) => [k.id, k])),
    positions,
    dailyCounts: {},
    ext: {},
  };
}

async function nextEpochNumber(s: StorageTx, states: readonly CharacterStateRecord[]): Promise<number> {
  let last = -1;
  for (const epochId of new Set(states.map((st) => st.epochId))) {
    const epoch = await s.epochs.findById(epochId);
    if (epoch) last = Math.max(last, epoch.number);
  }
  return last + 1;
}

function statsOf(st: CharacterStateRecord | undefined): Record<StatKey, number> {
  const stats = { ...DEFAULT_STATS };
  for (const key of STAT_KEYS) stats[key] = st?.stats[key] ?? stats[key];
  return stats;
}

function scoresOf(st: CharacterStateRecord | undefined): Record<ScoreName, number> {
  const scores = Object.fromEntries(SCORE_NAMES.map((n) => [n, 0])) as Record<ScoreName, number>;
  for (const name of SCORE_NAMES) scores[name] = st?.scores[name] ?? 0;
  return scores;
}

function toGoal(g: Goal): Goal {
  return {
    id: g.id,
    kind: g.kind,
    description: g.description,
    origin: g.origin,
    targetCharacterId: g.targetCharacterId,
    status: g.status,
  };
}
