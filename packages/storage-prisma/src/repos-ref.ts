import type { DirectiveRecord, GoalRecord, StorageTx } from '@ai-reality/engine';
import type { DirectiveBiases } from '@ai-reality/engine';
import type { Prisma } from '@prisma/client';
import { type Db, asRecord, cmp, guard, toNullableJson } from './support.js';

type RefRepos = Pick<
  StorageTx,
  'worlds' | 'seasons' | 'locations' | 'zones' | 'routes' | 'characters' | 'goals' | 'directives'
>;

/** Référentiel : monde, saison, lieux, personnages, objectifs, directives. */
export function refRepos(db: Db): RefRepos {
  return {
    worlds: {
      async insert(world) {
        await guard(() => db.world.create({ data: { ...world, config: world.config as Prisma.InputJsonObject } }));
      },
      async findById(id) {
        const row = await db.world.findUnique({ where: { id } });
        return row ? { id: row.id, name: row.name, seed: row.seed, config: asRecord(row.config) } : undefined;
      },
    },

    seasons: {
      async insert(season) {
        await guard(() =>
          db.season.create({
            data: {
              ...season,
              rules: season.rules as Prisma.InputJsonObject,
              format: season.format as Prisma.InputJsonObject,
            },
          }),
        );
      },
      async findByNumber(worldId, number) {
        const row = await db.season.findUnique({ where: { worldId_number: { worldId, number } } });
        return row
          ? {
              id: row.id,
              worldId: row.worldId,
              number: row.number,
              rules: asRecord(row.rules),
              rulesVersion: row.rulesVersion,
              format: asRecord(row.format),
            }
          : undefined;
      },
      async updateRules(id, rules, rulesVersion) {
        await guard(() =>
          db.season.update({ where: { id }, data: { rules: rules as Prisma.InputJsonObject, rulesVersion } }),
        );
      },
    },

    locations: {
      async insert(location) {
        await guard(() => db.location.create({ data: location }));
      },
      async listByWorld(worldId) {
        const rows = await db.location.findMany({ where: { worldId } });
        return rows.sort((a, b) => cmp(a.slug, b.slug));
      },
    },

    zones: {
      async insert(zone) {
        await guard(() => db.locationZone.create({ data: zone }));
      },
      async listByWorld(worldId) {
        const rows = await db.locationZone.findMany({ where: { location: { worldId } } });
        return rows
          .map((z) => ({
            id: z.id,
            locationId: z.locationId,
            slug: z.slug,
            hearingRange: z.hearingRange === 'location' ? ('location' as const) : ('zone' as const),
          }))
          .sort((a, b) => cmp(a.locationId, b.locationId) || cmp(a.slug, b.slug));
      },
    },

    routes: {
      async insert(route) {
        await guard(() => db.locationRoute.create({ data: route }));
      },
      async listByWorld(worldId) {
        const rows = await db.locationRoute.findMany({ where: { from: { worldId } } });
        return rows
          .map((r) => ({ fromLocationId: r.fromLocationId, toLocationId: r.toLocationId, travelTicks: r.travelTicks }))
          .sort((a, b) => cmp(a.fromLocationId, b.fromLocationId) || cmp(a.toLocationId, b.toLocationId));
      },
    },

    characters: {
      async insert(character) {
        const { traits, ...scalars } = character;
        await guard(() =>
          db.character.create({
            data: {
              ...scalars,
              traits: { create: Object.entries(traits).map(([trait, value]) => ({ trait, value })) },
            },
          }),
        );
      },
      async findById(id) {
        const row = await db.character.findUnique({ where: { id }, include: { traits: true } });
        return row ? toCharacterRecord(row) : undefined;
      },
      async listByWorld(worldId) {
        const rows = await db.character.findMany({ where: { worldId }, include: { traits: true } });
        return rows.map(toCharacterRecord).sort((a, b) => cmp(a.slug, b.slug));
      },
      async updateStatus(id, status) {
        await guard(() => db.character.update({ where: { id }, data: { status } }));
      },
    },

    goals: {
      async insert(goal) {
        const { createdEpoch, closedEpoch, ...rest } = goal;
        await guard(() => db.characterGoal.create({ data: { ...rest, createdEpoch, closedEpoch } }));
      },
      async listByWorld(worldId) {
        const rows = await db.characterGoal.findMany({ where: { character: { worldId } } });
        return rows
          .map((g): GoalRecord => ({
            id: g.id,
            characterId: g.characterId,
            kind: g.kind,
            description: g.description,
            origin: g.origin,
            targetCharacterId: g.targetCharacterId,
            status: g.status as GoalRecord['status'],
            createdEpoch: g.createdEpoch,
            closedEpoch: g.closedEpoch,
          }))
          .sort((a, b) => cmp(a.characterId, b.characterId) || cmp(a.id, b.id));
      },
    },

    directives: {
      async insert(directive) {
        await guard(() =>
          db.characterDirective.create({
            data: {
              id: directive.id,
              characterId: directive.characterId,
              text: directive.text,
              fromEpoch: directive.fromEpoch,
              toEpoch: directive.toEpoch,
              biases: toNullableJson(directive.biases),
            },
          }),
        );
      },
      async current(characterId, epochNumber) {
        const rows = await db.characterDirective.findMany({
          where: {
            characterId,
            fromEpoch: { lte: epochNumber },
            OR: [{ toEpoch: null }, { toEpoch: { gte: epochNumber } }],
          },
        });
        const best = rows.sort((a, b) => b.fromEpoch - a.fromEpoch || cmp(b.id, a.id))[0];
        if (!best) return undefined;
        const record: DirectiveRecord = {
          id: best.id,
          characterId: best.characterId,
          text: best.text,
          fromEpoch: best.fromEpoch,
          toEpoch: best.toEpoch,
          biases: best.biases === null ? null : (best.biases as unknown as DirectiveBiases),
        };
        return record;
      },
    },
  };
}

interface CharacterRow {
  id: string;
  worldId: string;
  slug: string;
  firstName: string;
  lastName: string | null;
  age: number | null;
  gender: string | null;
  origin: string | null;
  backstory: string | null;
  speechStyle: string | null;
  autonomy: 'autonomous' | 'guided' | 'directive';
  status: 'active' | 'restricted' | 'elimination_pending' | 'eliminated' | 'paused';
  traits: { trait: string; value: number }[];
}

function toCharacterRecord(row: CharacterRow) {
  return {
    id: row.id,
    worldId: row.worldId,
    slug: row.slug,
    firstName: row.firstName,
    lastName: row.lastName,
    age: row.age,
    gender: row.gender,
    origin: row.origin,
    backstory: row.backstory,
    speechStyle: row.speechStyle,
    autonomy: row.autonomy,
    status: row.status,
    traits: Object.fromEntries(row.traits.map((t) => [t.trait, t.value])),
  };
}
