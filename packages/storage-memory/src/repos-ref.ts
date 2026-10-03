import type { StorageTx } from '@ai-reality/engine';
import { type Db, cmp, copy, duplicate, later, notFound, require_ } from './db.js';

type RefRepos = Pick<
  StorageTx,
  'worlds' | 'seasons' | 'locations' | 'zones' | 'routes' | 'characters' | 'goals' | 'directives'
>;

/** Référentiel : monde, saison, lieux, personnages, objectifs, directives. */
export function refRepos(db: Db): RefRepos {
  const worldOfLocation = (locationId: string): string | undefined => db.locations.get(locationId)?.worldId;
  const worldOfCharacter = (characterId: string): string | undefined => db.characters.get(characterId)?.worldId;

  return {
    worlds: {
      insert: (world) =>
        later(() => {
          if (db.worlds.has(world.id)) throw duplicate(`Monde ${world.id}`);
          db.worlds.set(world.id, copy(world));
        }),
      findById: (id) => later(() => copy(db.worlds.get(id))),
    },

    seasons: {
      insert: (season) =>
        later(() => {
          require_(db.worlds.has(season.worldId), `Monde ${season.worldId}`);
          const taken = [...db.seasons.values()].some(
            (s) => s.id === season.id || (s.worldId === season.worldId && s.number === season.number),
          );
          if (taken) throw duplicate(`Saison ${String(season.number)}`);
          db.seasons.set(season.id, copy(season));
        }),
      findByNumber: (worldId, number) =>
        later(() => copy([...db.seasons.values()].find((s) => s.worldId === worldId && s.number === number))),
      findById: (id) => later(() => copy(db.seasons.get(id))),
      updateRules: (id, rules, rulesVersion) =>
        later(() => {
          const season = db.seasons.get(id);
          if (!season) throw notFound(`Saison ${id}`);
          db.seasons.set(id, copy({ ...season, rules, rulesVersion }));
        }),
    },

    locations: {
      insert: (location) =>
        later(() => {
          require_(db.worlds.has(location.worldId), `Monde ${location.worldId}`);
          const taken = [...db.locations.values()].some(
            (l) => l.id === location.id || (l.worldId === location.worldId && l.slug === location.slug),
          );
          if (taken) throw duplicate(`Lieu « ${location.slug} »`);
          db.locations.set(location.id, copy(location));
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.locations.values()]
            .filter((l) => l.worldId === worldId)
            .sort((a, b) => cmp(a.slug, b.slug))
            .map(copy),
        ),
    },

    zones: {
      insert: (zone) =>
        later(() => {
          require_(db.locations.has(zone.locationId), `Lieu ${zone.locationId}`);
          const taken = [...db.zones.values()].some(
            (z) => z.id === zone.id || (z.locationId === zone.locationId && z.slug === zone.slug),
          );
          if (taken) throw duplicate(`Zone « ${zone.slug} »`);
          db.zones.set(zone.id, copy(zone));
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.zones.values()]
            .filter((z) => worldOfLocation(z.locationId) === worldId)
            .sort((a, b) => cmp(a.locationId, b.locationId) || cmp(a.slug, b.slug))
            .map(copy),
        ),
    },

    routes: {
      insert: (route) =>
        later(() => {
          require_(db.locations.has(route.fromLocationId), `Lieu ${route.fromLocationId}`);
          require_(db.locations.has(route.toLocationId), `Lieu ${route.toLocationId}`);
          const taken = db.routes.some(
            (r) => r.fromLocationId === route.fromLocationId && r.toLocationId === route.toLocationId,
          );
          if (taken) throw duplicate('Route');
          db.routes.push(copy(route));
        }),
      listByWorld: (worldId) =>
        later(() =>
          db.routes
            .filter((r) => worldOfLocation(r.fromLocationId) === worldId)
            .sort((a, b) => cmp(a.fromLocationId, b.fromLocationId) || cmp(a.toLocationId, b.toLocationId))
            .map(copy),
        ),
    },

    characters: {
      insert: (character) =>
        later(() => {
          require_(db.worlds.has(character.worldId), `Monde ${character.worldId}`);
          const taken = [...db.characters.values()].some(
            (c) => c.id === character.id || (c.worldId === character.worldId && c.slug === character.slug),
          );
          if (taken) throw duplicate(`Personnage « ${character.slug} »`);
          db.characters.set(character.id, copy(character));
        }),
      findById: (id) => later(() => copy(db.characters.get(id))),
      listByWorld: (worldId) =>
        later(() =>
          [...db.characters.values()]
            .filter((c) => c.worldId === worldId)
            .sort((a, b) => cmp(a.slug, b.slug))
            .map(copy),
        ),
      updateStatus: (id, status) =>
        later(() => {
          const character = db.characters.get(id);
          if (!character) throw notFound(`Personnage ${id}`);
          db.characters.set(id, { ...character, status });
        }),
    },

    goals: {
      insert: (goal) =>
        later(() => {
          require_(db.characters.has(goal.characterId), `Personnage ${goal.characterId}`);
          if (goal.targetCharacterId !== null) {
            require_(db.characters.has(goal.targetCharacterId), `Personnage ${goal.targetCharacterId}`);
          }
          if (db.goals.has(goal.id)) throw duplicate(`Objectif ${goal.id}`);
          db.goals.set(goal.id, copy(goal));
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.goals.values()]
            .filter((g) => worldOfCharacter(g.characterId) === worldId)
            .sort((a, b) => cmp(a.characterId, b.characterId) || cmp(a.id, b.id))
            .map(copy),
        ),
    },

    directives: {
      insert: (directive) =>
        later(() => {
          require_(db.characters.has(directive.characterId), `Personnage ${directive.characterId}`);
          if (db.directives.has(directive.id)) throw duplicate(`Directive ${directive.id}`);
          db.directives.set(directive.id, copy(directive));
        }),
      current: (characterId, epochNumber) =>
        later(() =>
          copy(
            [...db.directives.values()]
              .filter(
                (d) =>
                  d.characterId === characterId &&
                  d.fromEpoch <= epochNumber &&
                  (d.toEpoch === null || d.toEpoch >= epochNumber),
              )
              .sort((a, b) => b.fromEpoch - a.fromEpoch || cmp(b.id, a.id))[0],
          ),
        ),
    },
  };
}
