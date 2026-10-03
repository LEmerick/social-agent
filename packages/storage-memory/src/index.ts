import {
  type CharacterRecord,
  type LocationRecord,
  DomainError,
  type StoragePort,
  type StorageTx,
  type WorldRecord,
} from '@ai-reality/engine';

/** État complet du stockage : une copie est prise au début de chaque transaction. */
interface State {
  worlds: Map<string, WorldRecord>;
  locations: Map<string, LocationRecord>;
  characters: Map<string, CharacterRecord>;
}

const emptyState = (): State => ({ worlds: new Map(), locations: new Map(), characters: new Map() });

const cloneState = (s: State): State => ({
  worlds: new Map(s.worlds),
  locations: new Map(s.locations),
  characters: new Map(s.characters),
});

/** Exécute une opération synchrone et renvoie une promesse ; une exception devient un rejet. */
const later = <T>(op: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(op());
  });

/**
 * Adaptateur en mémoire. Les transactions sont sérialisées (une à la fois) et atomiques :
 * si `fn` lève une exception, l'état précédent est restauré.
 */
export function createMemoryStorage(): StoragePort & { reset(): void } {
  let committed = emptyState();
  let queue: Promise<unknown> = Promise.resolve();

  return {
    reset() {
      committed = emptyState();
    },

    tx<T>(fn: (s: StorageTx) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        const working = cloneState(committed);
        const tx: StorageTx = {
          worlds: {
            insert: (world) =>
              later(() => {
                if (working.worlds.has(world.id)) throw new DomainError('DUPLICATE', `Monde ${world.id} déjà présent`);
                working.worlds.set(world.id, { ...world, config: { ...world.config } });
              }),
            findById: (id) => later(() => working.worlds.get(id)),
          },
          locations: {
            insert: (location) =>
              later(() => {
                requireWorld(working, location.worldId);
                const slugTaken = [...working.locations.values()].some(
                  (l) => l.worldId === location.worldId && l.slug === location.slug,
                );
                if (slugTaken)
                  throw new DomainError('DUPLICATE', `Lieu « ${location.slug} » déjà présent dans ce monde`);
                working.locations.set(location.id, { ...location });
              }),
            listByWorld: (worldId) =>
              later(() => [...working.locations.values()].filter((l) => l.worldId === worldId).map((l) => ({ ...l }))),
          },
          characters: {
            insert: (character) =>
              later(() => {
                requireWorld(working, character.worldId);
                const slugTaken = [...working.characters.values()].some(
                  (c) => c.worldId === character.worldId && c.slug === character.slug,
                );
                if (slugTaken) {
                  throw new DomainError('DUPLICATE', `Personnage « ${character.slug} » déjà présent dans ce monde`);
                }
                working.characters.set(character.id, { ...character, traits: { ...character.traits } });
              }),
            findById: (id) =>
              later(() => {
                const c = working.characters.get(id);
                return c && { ...c, traits: { ...c.traits } };
              }),
            listByWorld: (worldId) =>
              later(() =>
                [...working.characters.values()]
                  .filter((c) => c.worldId === worldId)
                  .map((c) => ({ ...c, traits: { ...c.traits } })),
              ),
          },
        };

        const result = await fn(tx);
        committed = working;
        return result;
      };

      // Sérialisation : chaque transaction attend la précédente, même si elle échoue.
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

function requireWorld(state: State, worldId: string): void {
  if (!state.worlds.has(worldId)) throw new DomainError('NOT_FOUND', `Monde ${worldId} introuvable`);
}
