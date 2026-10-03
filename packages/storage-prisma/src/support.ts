import { Prisma } from '@prisma/client';
import { DomainError } from '@ai-reality/engine';

export type Db = Prisma.TransactionClient;

/** Comparaison binaire : même ordre que `storage-memory`, quelle que soit la collation de la base. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Traduit les erreurs de contrainte Prisma en erreurs métier stables. */
export async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new DomainError('DUPLICATE', 'Identifiant ou clé unique déjà présent');
      if (error.code === 'P2003' || error.code === 'P2025') {
        throw new DomainError('NOT_FOUND', 'Rattachement à un enregistrement inexistant');
      }
    }
    throw error;
  }
}

/** Valeur JSON obligatoire : `null` devient le JSON `null`. */
export const toJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value === null || value === undefined ? Prisma.JsonNull : value;

/** Valeur JSON facultative : `null` devient SQL NULL. */
export const toNullableJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === null || value === undefined ? Prisma.DbNull : value;

export const asRecord = (value: Prisma.JsonValue): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

export const asNumberRecord = (value: Prisma.JsonValue): Record<string, number> =>
  asRecord(value) as Record<string, number>;
