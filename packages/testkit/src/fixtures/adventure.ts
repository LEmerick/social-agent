import type { LocationRecord, RelationshipEdge, RouteEdge } from '@ai-reality/engine';
import { aCharacter, aWorld, type WorldFixture } from '../builders.js';
import { fixedId } from './ids.js';

/** Lieux ajoutés au monde Palmiers pour le format « Aventure » (familles 0x11 : lieux, 0x32 : personnages). */
export const ADVENTURE_LOCATIONS = {
  foret: fixedId(0x11, 1),
  conseil: fixedId(0x11, 2),
  campNord: fixedId(0x11, 3),
  campSud: fixedId(0x11, 4),
} as const;

/** Personnages ajoutés aux quatre des Palmiers pour une saison de huit. */
export const ADVENTURE_EXTRA_SLUGS = ['julie', 'karim', 'marie', 'paul', 'nina', 'hugo', 'ines', 'louis'] as const;

const place = (id: string, slug: string, name: string, kind: string, isPrivate: boolean): LocationRecord => ({
  id,
  worldId: fixedId(0, 1),
  slug,
  name,
  kind,
  capacity: null,
  isPrivate,
  visualRef: null,
});

export const ADVENTURE_LOCATION_RECORDS: readonly LocationRecord[] = [
  place(ADVENTURE_LOCATIONS.foret, 'foret', 'Forêt', 'forest', false),
  place(ADVENTURE_LOCATIONS.conseil, 'conseil', 'Conseil', 'council', false),
  place(ADVENTURE_LOCATIONS.campNord, 'camp_north', 'Camp nord', 'camp', true),
  place(ADVENTURE_LOCATIONS.campSud, 'camp_south', 'Camp sud', 'camp', true),
];

const both = (a: string, b: string, travelTicks: number): RouteEdge[] => [
  { fromLocationId: a, toLocationId: b, travelTicks },
  { fromLocationId: b, toLocationId: a, travelTicks },
];

/** Routes des lieux ajoutés, reliés aux lieux des Palmiers (salon et jardin). */
export const ADVENTURE_ROUTES: readonly RouteEdge[] = [
  ...both(fixedId(0x10, 3), ADVENTURE_LOCATIONS.conseil, 1),
  ...both(fixedId(0x10, 2), ADVENTURE_LOCATIONS.foret, 1),
  ...both(fixedId(0x10, 3), ADVENTURE_LOCATIONS.foret, 2),
  ...both(fixedId(0x10, 2), ADVENTURE_LOCATIONS.campNord, 1),
  ...both(fixedId(0x10, 3), ADVENTURE_LOCATIONS.campSud, 1),
  ...both(ADVENTURE_LOCATIONS.conseil, ADVENTURE_LOCATIONS.foret, 2),
];

export interface AdventureWorldOptions {
  readonly seed?: string;
  /** Nombre de personnages : 4 (Palmiers), 8 ou 12. */
  readonly characters?: 4 | 8 | 12;
  /** Économie de crédits (désactivée par défaut, comme le format Aventure). */
  readonly economy?: boolean;
  /** Relations ajoutées ou remplacées par rapport aux Palmiers. */
  readonly relationships?: readonly RelationshipEdge[];
}

/**
 * Monde « Aventure » : les Palmiers, quatre autres personnages au besoin, une forêt, un lieu de conseil et deux camps
 * privés. La saison porte l'économie désactivée ; les actions d'objet sont activées par les hooks de format.
 */
export function adventureWorld(options: AdventureWorldOptions = {}): WorldFixture {
  const builder = aWorld();
  if (options.seed) builder.withSeed(options.seed);
  const count = options.characters ?? 8;
  if (count > 4) {
    builder.withCharacters(
      aCharacter('alexandre'),
      aCharacter('sarah'),
      aCharacter('lea'),
      aCharacter('thomas'),
      ...ADVENTURE_EXTRA_SLUGS.slice(0, count - 4).map((slug) => aCharacter(slug)),
    );
  }
  for (const edge of options.relationships ?? []) builder.withRelationship(edge);
  const base = builder.build();
  return {
    ...base,
    season: {
      ...base.season,
      rules: { economy: { enabled: options.economy ?? false } },
      format: { format: 'adventure' },
    },
    locations: [...base.locations, ...ADVENTURE_LOCATION_RECORDS],
    routes: [...base.routes, ...ADVENTURE_ROUTES],
  };
}
