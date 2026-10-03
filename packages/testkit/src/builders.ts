import {
  type CharacterAutonomy,
  type CharacterNode,
  type CharacterRecord,
  type DirectiveRecord,
  type FactNode,
  type GoalRecord,
  type KnowledgeEdge,
  type LocationNode,
  type LocationRecord,
  type Position,
  type RelationshipEdge,
  type RouteEdge,
  type SeasonRecord,
  type SimState,
  type StoragePort,
  type WorldRecord,
  type ZoneRecord,
  DEFAULT_SEASON_RULES,
  DEFAULT_WORLD_CONFIG,
  relKey,
} from '@ai-reality/engine';
import { fixedId, IDS } from './fixtures/ids.js';
import {
  PALMIERS_CHARACTERS,
  PALMIERS_FACTS,
  PALMIERS_GOALS,
  PALMIERS_KNOWLEDGE,
  PALMIERS_LOCATIONS,
  PALMIERS_ROUTES,
  PALMIERS_SEED,
  PALMIERS_ZONES,
  palmiersRelationships,
} from './fixtures/palmiers.js';

/** Tout ce qu'il faut écrire en base pour créer un monde. */
export interface WorldFixture {
  readonly world: WorldRecord;
  readonly season: SeasonRecord;
  readonly locations: readonly LocationRecord[];
  readonly zones: readonly ZoneRecord[];
  readonly routes: readonly RouteEdge[];
  readonly characters: readonly CharacterRecord[];
  readonly goals: readonly GoalRecord[];
  readonly directives: readonly DirectiveRecord[];
  readonly relationships: readonly RelationshipEdge[];
  readonly facts: readonly FactNode[];
  readonly knowledge: readonly KnowledgeEdge[];
}

const bySlug = <T extends { slug: string }>(a: T, b: T): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** Identifiant stable pour un slug inconnu de la fixture (hachage FNV-1a sur 24 bits). */
function idForSlug(slug: string): string {
  let h = 0x811c9dc5;
  for (const ch of slug) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return fixedId(0x31, h & 0xffffff);
}

export class CharacterBuilder {
  private record: CharacterRecord;
  private readonly goals: GoalRecord[] = [];

  constructor(slug: string) {
    const known = PALMIERS_CHARACTERS.find((c) => c.slug === slug);
    this.record = known
      ? { ...known, traits: { ...known.traits } }
      : {
          id: idForSlug(slug),
          worldId: IDS.world,
          slug,
          firstName: slug.charAt(0).toUpperCase() + slug.slice(1),
          lastName: null,
          age: null,
          gender: null,
          origin: null,
          backstory: null,
          speechStyle: null,
          autonomy: 'autonomous',
          status: 'active',
          traits: {},
        };
    this.goals.push(...PALMIERS_GOALS.filter((g) => g.characterId === this.record.id));
  }

  withTrait(trait: string, value: number): this {
    this.record = { ...this.record, traits: { ...this.record.traits, [trait]: value } };
    return this;
  }

  withAutonomy(autonomy: CharacterAutonomy): this {
    this.record = { ...this.record, autonomy };
    return this;
  }

  withFirstName(firstName: string): this {
    this.record = { ...this.record, firstName };
    return this;
  }

  withoutGoals(): this {
    this.goals.length = 0;
    return this;
  }

  build(): CharacterRecord {
    return { ...this.record, traits: { ...this.record.traits } };
  }

  buildGoals(): GoalRecord[] {
    return this.goals.map((g) => ({ ...g, characterId: this.record.id }));
  }
}

/** `aCharacter('alexandre').withTrait('loyalty', 10)` : part du personnage de la fixture s'il existe. */
export const aCharacter = (slug: string): CharacterBuilder => new CharacterBuilder(slug);

export class WorldBuilder {
  private characters: CharacterBuilder[] = PALMIERS_CHARACTERS.map((c) => new CharacterBuilder(c.slug));
  private relationships: RelationshipEdge[] = palmiersRelationships();
  private facts: FactNode[] = [...PALMIERS_FACTS];
  private knowledge: KnowledgeEdge[] = [...PALMIERS_KNOWLEDGE];
  private directives: DirectiveRecord[] = [];
  private seed = PALMIERS_SEED;

  /** Remplace les personnages ; relations, faits et connaissances sont filtrés sur ceux qui restent. */
  withCharacters(...characters: CharacterBuilder[]): this {
    this.characters = characters;
    return this;
  }

  withSeed(seed: string): this {
    this.seed = seed;
    return this;
  }

  withDirective(directive: DirectiveRecord): this {
    this.directives.push(directive);
    return this;
  }

  withRelationship(edge: RelationshipEdge): this {
    this.relationships = [
      ...this.relationships.filter((r) => relKey(r.sourceId, r.targetId) !== relKey(edge.sourceId, edge.targetId)),
      edge,
    ];
    return this;
  }

  build(): WorldFixture {
    const records = this.characters.map((c) => c.build()).sort(bySlug);
    const ids = new Set(records.map((c) => c.id));
    const facts = this.facts.filter((f) => f.subjectId === null || ids.has(f.subjectId));
    const factIds = new Set(facts.map((f) => f.id));
    return {
      world: { id: IDS.world, name: 'Maison des Palmiers', seed: this.seed, config: { ...DEFAULT_WORLD_CONFIG } },
      season: { id: IDS.season, worldId: IDS.world, number: 1, rules: {}, rulesVersion: 1, format: {} },
      locations: PALMIERS_LOCATIONS.map((l) => ({ ...l })),
      zones: PALMIERS_ZONES.map((z) => ({ ...z })),
      routes: PALMIERS_ROUTES.map((r) => ({ ...r })),
      characters: records,
      goals: this.characters
        .flatMap((c) => c.buildGoals())
        .filter((g) => g.targetCharacterId === null || ids.has(g.targetCharacterId)),
      directives: this.directives.filter((d) => ids.has(d.characterId)),
      relationships: this.relationships
        .filter((r) => ids.has(r.sourceId) && ids.has(r.targetId))
        .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.targetId < b.targetId ? -1 : 1))
        .map((r) => ({ ...r, labels: [...r.labels], extraAxes: { ...r.extraAxes } })),
      facts,
      knowledge: this.knowledge.filter((k) => ids.has(k.characterId) && factIds.has(k.factId)),
    };
  }
}

/** `aWorld().withCharacters(aCharacter('alexandre'), …).build()` : le monde « Maison des Palmiers » par défaut. */
export const aWorld = (): WorldBuilder => new WorldBuilder();

/** Écrit un monde dans un stockage (dans une transaction). */
export async function seedWorld(storage: StoragePort, fixture: WorldFixture = aWorld().build()): Promise<WorldFixture> {
  await storage.tx(async (s) => {
    await s.worlds.insert(fixture.world);
    await s.seasons.insert(fixture.season);
    for (const l of fixture.locations) await s.locations.insert(l);
    for (const z of fixture.zones) await s.zones.insert(z);
    for (const r of fixture.routes) await s.routes.insert(r);
    for (const c of fixture.characters) await s.characters.insert(c);
    for (const g of fixture.goals) await s.goals.insert(g);
    for (const d of fixture.directives) await s.directives.insert(d);
    await s.relationships.upsert(fixture.world.id, fixture.relationships);
    await s.facts.insert(fixture.world.id, fixture.facts);
    await s.knowledge.insert(fixture.knowledge);
  });
  return fixture;
}

/** Le `SimState` que `loadSimState` doit produire pour ce monde fraîchement créé (époque 0, rien joué). */
export function simStateOf(fixture: WorldFixture): SimState {
  const rules = structuredClone(DEFAULT_SEASON_RULES);
  const characters: Record<string, CharacterNode> = {};
  const positions: Record<string, Position> = {};
  for (const c of fixture.characters) {
    const directive = fixture.directives.find(
      (d) => d.characterId === c.id && d.fromEpoch <= 0 && (d.toEpoch === null || d.toEpoch >= 0),
    );
    characters[c.id] = {
      id: c.id,
      slug: c.slug,
      firstName: c.firstName,
      autonomy: c.autonomy,
      status: c.status,
      traits: { ...c.traits },
      stats: { energy: 100, morale: 60, popularity: 50, influence: 50, reputation: 50 },
      credits: rules.economy.startingCredits,
      mood: {},
      scores: { social: 0, drama: 0, popularity: 0, survival: 0, influence: 0 },
      goals: fixture.goals
        .filter((g) => g.characterId === c.id)
        .map((g) => ({
          id: g.id,
          kind: g.kind,
          description: g.description,
          origin: g.origin,
          targetCharacterId: g.targetCharacterId,
          status: g.status,
        })),
      directive: directive?.biases ?? null,
      agenda: [],
      restrictedSinceEpoch: null,
    };
    positions[c.id] = { kind: 'offstage', reason: 'initial', lastLocationId: null };
  }
  const locations: Record<string, LocationNode> = {};
  for (const l of [...fixture.locations].sort(bySlug)) {
    locations[l.id] = {
      id: l.id,
      slug: l.slug,
      name: l.name,
      kind: l.kind,
      capacity: l.capacity,
      isPrivate: l.isPrivate,
      zones: fixture.zones
        .filter((z) => z.locationId === l.id)
        .sort(bySlug)
        .map((z) => ({ id: z.id, slug: z.slug, hearingRange: z.hearingRange })),
    };
  }
  return {
    world: { id: fixture.world.id, seed: fixture.world.seed, config: { ...DEFAULT_WORLD_CONFIG } },
    season: { id: fixture.season.id, number: fixture.season.number, rulesVersion: fixture.season.rulesVersion, rules },
    epoch: null,
    tick: 0,
    nextEventSeq: 1,
    characters,
    relationships: Object.fromEntries(
      fixture.relationships.map((r) => [relKey(r.sourceId, r.targetId), structuredClone(r)]),
    ),
    locations,
    routes: [...fixture.routes]
      .map((r) => ({ ...r }))
      .sort((a, b) =>
        a.fromLocationId < b.fromLocationId
          ? -1
          : a.fromLocationId > b.fromLocationId
            ? 1
            : a.toLocationId < b.toLocationId
              ? -1
              : 1,
      ),
    facts: Object.fromEntries(fixture.facts.map((f) => [f.id, { ...f }])),
    knowledge: Object.fromEntries(fixture.knowledge.map((k) => [k.id, { ...k }])),
    positions,
    dailyCounts: {},
    ext: {},
  };
}

/** SimState en mémoire prêt à l'emploi (monde « Maison des Palmiers »), sans stockage. */
export function aSimState(mutate?: (state: SimState) => void): SimState {
  const state = simStateOf(aWorld().build());
  mutate?.(state);
  return state;
}
