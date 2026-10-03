import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import { type Result, err, ok } from '../core/result.js';
import type { LocationRecord, SeasonRecord, StoragePort, WorldRecord, ZoneRecord } from '../ports/storage.js';
import { type RouteEdge, DEFAULT_WORLD_CONFIG } from '../state/types.js';
import { WorldSetupSchema } from './world-spec.js';

export interface WorldSetupResult {
  readonly world: WorldRecord;
  readonly season: SeasonRecord;
  readonly locations: readonly LocationRecord[];
  readonly zones: readonly ZoneRecord[];
  readonly routes: readonly RouteEdge[];
}

export interface WorldService {
  /** Crée monde, saison, lieux, zones et routes dans une seule transaction. */
  setup(input: unknown): Promise<Result<WorldSetupResult>>;
}

export function createWorldService(storage: StoragePort, ids: IdFactory): WorldService {
  return {
    async setup(input) {
      const parsed = WorldSetupSchema.safeParse(input);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join('; ');
        return err(new DomainError('INVALID_WORLD', `Monde invalide — ${detail}`));
      }
      const spec = parsed.data;

      const world: WorldRecord = {
        id: ids.next(),
        name: spec.world.name,
        seed: spec.world.seed,
        config: { ...DEFAULT_WORLD_CONFIG, ...spec.world.config },
      };
      const season: SeasonRecord = {
        id: ids.next(),
        worldId: world.id,
        number: spec.season.number,
        rules: spec.season.rules,
        rulesVersion: 1,
        format: spec.season.format,
      };
      const locations: LocationRecord[] = [];
      const zones: ZoneRecord[] = [];
      for (const l of spec.locations) {
        const location: LocationRecord = {
          id: ids.next(),
          worldId: world.id,
          slug: l.slug,
          name: l.name,
          kind: l.kind,
          capacity: l.capacity,
          isPrivate: l.isPrivate,
          visualRef: l.visualRef,
        };
        locations.push(location);
        for (const z of l.zones) {
          zones.push({ id: ids.next(), locationId: location.id, slug: z.slug, hearingRange: z.hearingRange });
        }
      }
      const idOf = new Map(locations.map((l) => [l.slug, l.id]));
      const routes: RouteEdge[] = [];
      for (const r of spec.routes) {
        const from = idOf.get(r.from);
        const to = idOf.get(r.to);
        if (from === undefined || to === undefined) continue; // déjà rejeté par le schéma
        routes.push({ fromLocationId: from, toLocationId: to, travelTicks: r.travelTicks });
        if (r.bothWays) routes.push({ fromLocationId: to, toLocationId: from, travelTicks: r.travelTicks });
      }

      try {
        await storage.tx(async (s) => {
          await s.worlds.insert(world);
          await s.seasons.insert(season);
          for (const l of locations) await s.locations.insert(l);
          for (const z of zones) await s.zones.insert(z);
          for (const r of routes) await s.routes.insert(r);
        });
      } catch (error) {
        if (error instanceof DomainError) return err(error);
        throw error;
      }
      return ok({ world, season, locations, zones, routes });
    },
  };
}
