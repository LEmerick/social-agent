/**
 * Port de stockage. Le moteur ne connaît que ces interfaces ; les adaptateurs
 * (`storage-memory`, `storage-prisma`) les implémentent et doivent passer la même suite de contrat.
 *
 * Erreurs attendues par les adaptateurs :
 * - `DomainError('DUPLICATE', …)` : slug déjà pris dans le même monde ;
 * - `DomainError('NOT_FOUND', …)` : rattachement à un monde inexistant.
 */

export type CharacterAutonomy = 'autonomous' | 'guided' | 'directive';
export type CharacterStatus = 'active' | 'restricted' | 'elimination_pending' | 'eliminated' | 'paused';

export interface WorldRecord {
  readonly id: string;
  readonly name: string;
  readonly seed: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface LocationRecord {
  readonly id: string;
  readonly worldId: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly capacity: number | null;
  readonly isPrivate: boolean;
  readonly visualRef: string | null;
}

export interface CharacterRecord {
  readonly id: string;
  readonly worldId: string;
  readonly slug: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly age: number | null;
  readonly autonomy: CharacterAutonomy;
  readonly status: CharacterStatus;
  readonly traits: Readonly<Record<string, number>>;
}

export interface WorldRepository {
  insert(world: WorldRecord): Promise<void>;
  findById(id: string): Promise<WorldRecord | undefined>;
}

export interface LocationRepository {
  insert(location: LocationRecord): Promise<void>;
  listByWorld(worldId: string): Promise<LocationRecord[]>;
}

export interface CharacterRepository {
  insert(character: CharacterRecord): Promise<void>;
  findById(id: string): Promise<CharacterRecord | undefined>;
  listByWorld(worldId: string): Promise<CharacterRecord[]>;
}

export interface StorageTx {
  readonly worlds: WorldRepository;
  readonly locations: LocationRepository;
  readonly characters: CharacterRepository;
}

export interface StoragePort {
  /** Exécute `fn` dans une transaction : toute exception annule tout ce qui a été écrit. */
  tx<T>(fn: (s: StorageTx) => Promise<T>): Promise<T>;
}
