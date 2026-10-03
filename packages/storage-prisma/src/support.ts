import { Prisma } from '@prisma/client';
import { DomainError } from '@ai-reality/engine';

export type Db = Prisma.TransactionClient;

/** Comparaison binaire : même ordre que `storage-memory`, quelle que soit la collation de la base. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Code SQLSTATE d'une erreur Prisma qui n'a pas de code `P20xx` propre (requêtes brutes, contraintes `EXCLUDE`/`CHECK`). */
function sqlStateOf(error: unknown): { readonly state: string; readonly constraint: string } | null {
  const meta = (error as { meta?: { code?: unknown } }).meta;
  const message = error instanceof Error ? error.message : '';
  const state =
    typeof meta?.code === 'string' && /^[0-9A-Z]{5}$/.test(meta.code)
      ? meta.code
      : (/\b(23P01|23514)\b/.exec(message)?.[1] ?? null);
  if (state === null) return null;
  return { state, constraint: /constraint "([^"]+)"/.exec(message)?.[1] ?? '' };
}

/**
 * Traduit les erreurs de contrainte Prisma et Postgres en erreurs métier stables :
 * `DUPLICATE` (unicité), `NOT_FOUND` (clé étrangère), `PRESENCE_OVERLAP` (exclusion `23P01` : deux segments de présence
 * qui se chevauchent), `CONSTRAINT_VIOLATION` (`CHECK`, `23514`).
 */
export async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const sql = sqlStateOf(error);
    if (sql?.state === '23P01') {
      throw new DomainError(
        'PRESENCE_OVERLAP',
        `Présence en chevauchement (contrainte d'exclusion ${sql.constraint || 'presence_no_overlap'})`,
      );
    }
    if (sql?.state === '23514') {
      throw new DomainError('CONSTRAINT_VIOLATION', `Contrainte CHECK violée (${sql.constraint || 'check'})`);
    }
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
