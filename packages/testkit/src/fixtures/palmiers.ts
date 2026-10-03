import type {
  CharacterRecord,
  FactNode,
  GoalRecord,
  KnowledgeEdge,
  LocationRecord,
  RelationshipEdge,
  RouteEdge,
  ZoneRecord,
} from '@ai-reality/engine';
import { DEFAULT_WORLD_CONFIG, defaultEdge } from '@ai-reality/engine';
import { IDS } from './ids.js';

/** Graine du monde de test (implementation-plan.md §3). */
export const PALMIERS_SEED = 'palmiers-test';

const L = IDS.locations;

export const PALMIERS_LOCATIONS: readonly LocationRecord[] = [
  {
    id: L.cuisine,
    worldId: IDS.world,
    slug: 'cuisine',
    name: 'Cuisine',
    kind: 'kitchen',
    capacity: 6,
    isPrivate: false,
    visualRef: null,
  },
  {
    id: L.jardin,
    worldId: IDS.world,
    slug: 'jardin',
    name: 'Jardin',
    kind: 'garden',
    capacity: null,
    isPrivate: false,
    visualRef: 'jardin.png',
  },
  {
    id: L.salon,
    worldId: IDS.world,
    slug: 'salon',
    name: 'Salon',
    kind: 'living_room',
    capacity: 10,
    isPrivate: false,
    visualRef: null,
  },
  {
    id: L.chambres,
    worldId: IDS.world,
    slug: 'chambres',
    name: 'Chambres',
    kind: 'bedroom',
    capacity: 8,
    isPrivate: true,
    visualRef: null,
  },
  {
    id: L.confessionnal,
    worldId: IDS.world,
    slug: 'confessionnal',
    name: 'Confessionnal',
    kind: 'confessional',
    capacity: 1,
    isPrivate: true,
    visualRef: 'confessionnal.png',
  },
];

export const PALMIERS_ZONES: readonly ZoneRecord[] = [
  { id: IDS.zones.banc, locationId: L.jardin, slug: 'banc', hearingRange: 'zone' },
  { id: IDS.zones.piscine, locationId: L.jardin, slug: 'piscine', hearingRange: 'zone' },
];

/** Routes dirigées, dans les deux sens (1 à 2 ticks). */
export const PALMIERS_ROUTES: readonly RouteEdge[] = [
  ...both(L.cuisine, L.salon, 1),
  ...both(L.salon, L.jardin, 1),
  ...both(L.salon, L.chambres, 1),
  ...both(L.salon, L.confessionnal, 1),
  ...both(L.cuisine, L.jardin, 2),
  ...both(L.chambres, L.confessionnal, 2),
];

function both(a: string, b: string, travelTicks: number): RouteEdge[] {
  return [
    { fromLocationId: a, toLocationId: b, travelTicks },
    { fromLocationId: b, toLocationId: a, travelTicks },
  ];
}

/** Traits complets des quatre personnages. */
export const PALMIERS_TRAITS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
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

export const PALMIERS_CHARACTERS: readonly CharacterRecord[] = [
  {
    id: IDS.characters.alexandre,
    worldId: IDS.world,
    slug: 'alexandre',
    firstName: 'Alexandre',
    lastName: null,
    age: 34,
    gender: 'homme',
    origin: 'Lyon',
    backstory: 'Ancien commercial qui a toujours su convaincre.',
    speechStyle: 'posé, séducteur, phrases soignées',
    autonomy: 'autonomous',
    status: 'active',
    traits: { ...PALMIERS_TRAITS['alexandre'] },
  },
  {
    id: IDS.characters.sarah,
    worldId: IDS.world,
    slug: 'sarah',
    firstName: 'Sarah',
    lastName: null,
    age: 29,
    gender: 'femme',
    origin: 'Nantes',
    backstory: null,
    speechStyle: null,
    autonomy: 'autonomous',
    status: 'active',
    traits: { ...PALMIERS_TRAITS['sarah'] },
  },
  {
    id: IDS.characters.lea,
    worldId: IDS.world,
    slug: 'lea',
    firstName: 'Léa',
    lastName: null,
    age: 26,
    gender: 'femme',
    origin: null,
    backstory: null,
    speechStyle: 'chaleureux, direct',
    autonomy: 'guided',
    status: 'active',
    traits: { ...PALMIERS_TRAITS['lea'] },
  },
  {
    id: IDS.characters.thomas,
    worldId: IDS.world,
    slug: 'thomas',
    firstName: 'Thomas',
    lastName: null,
    age: 31,
    gender: 'homme',
    origin: 'Marseille',
    backstory: null,
    speechStyle: 'vif, taquin',
    autonomy: 'autonomous',
    status: 'active',
    traits: { ...PALMIERS_TRAITS['thomas'] },
  },
];

export const PALMIERS_GOALS: readonly GoalRecord[] = [
  {
    id: IDS.goals.alexandreMain,
    characterId: IDS.characters.alexandre,
    kind: 'main',
    description: 'Gagner la saison',
    origin: 'player',
    targetCharacterId: null,
    status: 'open',
    createdEpoch: null,
    closedEpoch: null,
  },
  {
    id: IDS.goals.sarahPrivate,
    characterId: IDS.characters.sarah,
    kind: 'private',
    description: 'Protéger son secret',
    origin: 'player',
    targetCharacterId: null,
    status: 'open',
    createdEpoch: null,
    closedEpoch: null,
  },
  {
    id: IDS.goals.thomasRival,
    characterId: IDS.characters.thomas,
    kind: 'social',
    description: 'Dépasser Alexandre',
    origin: 'ai',
    targetCharacterId: IDS.characters.alexandre,
    status: 'open',
    createdEpoch: null,
    closedEpoch: null,
  },
];

/** État relationnel initial : trust(Sarah→Alexandre) = 30 ; alliance(Sarah↔Léa) = 80 dans les deux sens. */
export function palmiersRelationships(): RelationshipEdge[] {
  const C = IDS.characters;
  const sarahToAlexandre: RelationshipEdge = { ...defaultEdge(C.sarah, C.alexandre), trust: 30, acquaintance: 'met' };
  const ally = (source: string, target: string): RelationshipEdge => ({
    ...defaultEdge(source, target),
    trust: 70,
    affection: 40,
    alliance: 80,
    acquaintance: 'close',
    interactionCount: 12,
    labels: ['allié secret'],
  });
  return [sarahToAlexandre, ally(C.sarah, C.lea), ally(C.lea, C.sarah)].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.targetId < b.targetId ? -1 : 1,
  );
}

/** Le secret de Sarah : un fait vrai, très sensible, connu d'elle seule au départ. */
export const PALMIERS_FACTS: readonly FactNode[] = [
  {
    id: IDS.facts.sarahSecret,
    subjectId: IDS.characters.sarah,
    predicate: 'hides',
    objectId: null,
    objectText: 'a déjà participé à une autre émission',
    isTrue: true,
    sensitivity: 3,
    originEventId: null,
    inventedById: null,
  },
];

export const PALMIERS_KNOWLEDGE: readonly KnowledgeEdge[] = [
  {
    id: IDS.knowledge.sarahSecret,
    characterId: IDS.characters.sarah,
    factId: IDS.facts.sarahSecret,
    sourceType: 'seeded',
    toldById: null,
    viaEventId: null,
    parentKnowledgeId: null,
    learnedEpoch: 0,
    learnedTick: 0,
    confidence: 1,
    belief: 'believes',
  },
];

export const PALMIERS_WORLD_CONFIG = { ...DEFAULT_WORLD_CONFIG };

/** Entrée de `WorldService.setup` décrivant le même monde (les identifiants, eux, sont générés). */
export function palmiersSetupInput() {
  const slugOf = new Map(PALMIERS_LOCATIONS.map((l) => [l.id, l.slug]));
  const routes = PALMIERS_ROUTES.filter((r) => r.fromLocationId < r.toLocationId).map((r) => ({
    from: slugOf.get(r.fromLocationId) ?? '',
    to: slugOf.get(r.toLocationId) ?? '',
    travelTicks: r.travelTicks,
    bothWays: true,
  }));
  return {
    world: { name: 'Maison des Palmiers', seed: PALMIERS_SEED },
    season: { number: 1 },
    locations: PALMIERS_LOCATIONS.map((l) => ({
      slug: l.slug,
      name: l.name,
      kind: l.kind,
      capacity: l.capacity,
      isPrivate: l.isPrivate,
      visualRef: l.visualRef,
      zones: PALMIERS_ZONES.filter((z) => z.locationId === l.id).map((z) => ({
        slug: z.slug,
        hearingRange: z.hearingRange,
      })),
    })),
    routes,
  };
}
