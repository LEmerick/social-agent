import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type CharacterRecord,
  type LocationRecord,
  DomainError,
  type StoragePort,
  type StorageTx,
  type WorldRecord,
} from '@ai-reality/engine';

type Db = Prisma.TransactionClient;

/**
 * Adaptateur StoragePort sur Prisma. Le `PrismaClient` est fourni par l'application ;
 * cette fonction ne crée aucune connexion.
 */
export function prismaStorage(prisma: PrismaClient): StoragePort {
  return {
    tx: (fn) => prisma.$transaction((db) => fn(toStorageTx(db))),
  };
}

function toStorageTx(db: Db): StorageTx {
  return {
    worlds: {
      async insert(world: WorldRecord) {
        await guard(() =>
          db.world.create({
            data: { ...world, config: world.config as Prisma.InputJsonObject },
          }),
        );
      },
      async findById(id) {
        const row = await db.world.findUnique({ where: { id } });
        if (!row) return undefined;
        return { id: row.id, name: row.name, seed: row.seed, config: row.config as Record<string, unknown> };
      },
    },

    locations: {
      async insert(location: LocationRecord) {
        await guard(() => db.location.create({ data: location }));
      },
      async listByWorld(worldId) {
        return db.location.findMany({ where: { worldId }, orderBy: { slug: 'asc' } });
      },
    },

    characters: {
      async insert(character: CharacterRecord) {
        const { traits, ...scalars } = character;
        await guard(() =>
          db.character.create({
            data: {
              ...scalars,
              traits: {
                create: Object.entries(traits).map(([trait, value]) => ({ trait, value })),
              },
            },
          }),
        );
      },
      async findById(id) {
        const row = await db.character.findUnique({ where: { id }, include: { traits: true } });
        return row ? toCharacterRecord(row) : undefined;
      },
      async listByWorld(worldId) {
        const rows = await db.character.findMany({
          where: { worldId },
          include: { traits: true },
          orderBy: { slug: 'asc' },
        });
        return rows.map(toCharacterRecord);
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
  autonomy: CharacterRecord['autonomy'];
  status: CharacterRecord['status'];
  traits: { trait: string; value: number }[];
}

function toCharacterRecord(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    worldId: row.worldId,
    slug: row.slug,
    firstName: row.firstName,
    lastName: row.lastName,
    age: row.age,
    autonomy: row.autonomy,
    status: row.status,
    traits: Object.fromEntries(row.traits.map((t) => [t.trait, t.value])),
  };
}

/** Traduit les erreurs de contrainte Prisma en erreurs métier stables. */
async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new DomainError('DUPLICATE', 'Slug déjà pris dans ce monde');
      if (error.code === 'P2003') throw new DomainError('NOT_FOUND', 'Rattachement à un enregistrement inexistant');
    }
    throw error;
  }
}
