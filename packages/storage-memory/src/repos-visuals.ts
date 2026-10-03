import type { StorageTx } from '@ai-reality/engine';
import { type Db, cmp, copy, duplicate, later, require_ } from './db.js';

/** Versions visuelles des personnages (`character_visual`). */
export function visualRepos(db: Db): Pick<StorageTx, 'characterVisuals'> {
  return {
    characterVisuals: {
      insert: (visual) =>
        later(() => {
          const key = `${visual.characterId}|${String(visual.version)}`;
          if (db.characterVisuals.has(key)) throw duplicate(`Version visuelle ${key}`);
          require_(db.characters.has(visual.characterId), `Personnage ${visual.characterId}`);
          db.characterVisuals.set(key, copy(visual));
        }),
      listByWorld: (worldId) =>
        later(() =>
          [...db.characterVisuals.values()]
            .filter((v) => db.characters.get(v.characterId)?.worldId === worldId)
            .sort((a, b) => cmp(a.characterId, b.characterId) || a.version - b.version)
            .map(copy),
        ),
    },
  };
}
