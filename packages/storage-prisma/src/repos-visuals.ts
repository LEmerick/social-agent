import type { CharacterVisualRecord, StorageTx } from '@ai-reality/engine';
import { type Db, guard } from './support.js';

/** Versions visuelles des personnages (`character_visual`). */
export function visualRepos(db: Db): Pick<StorageTx, 'characterVisuals'> {
  return {
    characterVisuals: {
      insert: (v) =>
        guard(async () => {
          await db.characterVisual.create({
            data: {
              characterId: v.characterId,
              version: v.version,
              referenceImages: [...v.referenceImages],
              voiceId: v.voiceId,
              wardrobeId: v.wardrobeId,
              visualDescription: v.visualDescription,
              validFromEpoch: v.validFromEpoch,
            },
          });
        }),
      listByWorld: (worldId) =>
        guard(async () => {
          const rows = await db.characterVisual.findMany({
            where: { character: { worldId } },
            orderBy: [{ characterId: 'asc' }, { version: 'asc' }],
          });
          return rows.map((r): CharacterVisualRecord => ({
            characterId: r.characterId,
            version: r.version,
            referenceImages: r.referenceImages,
            voiceId: r.voiceId,
            wardrobeId: r.wardrobeId,
            visualDescription: r.visualDescription,
            validFromEpoch: r.validFromEpoch,
          }));
        }),
    },
  };
}
