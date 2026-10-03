import { describe, expect, it } from 'vitest';
import type { CharacterVisualRecord } from '@ai-reality/engine';
import { seedWorld } from '../builders.js';
import { fixedId, IDS } from '../fixtures/ids.js';
import { type HarnessRef, expectCode } from './support.js';

const C = IDS.characters;

const visual = (
  characterId: string,
  version: number,
  over: Partial<CharacterVisualRecord> = {},
): CharacterVisualRecord => ({
  characterId,
  version,
  referenceImages: [`img/${String(version)}-a.png`, `img/${String(version)}-b.png`],
  voiceId: 'voix-1',
  wardrobeId: null,
  visualDescription: `Tenue v${String(version)}`,
  validFromEpoch: version * 5,
  ...over,
});

export function visualsContract(h: HarnessRef): void {
  describe('versions visuelles (character_visual)', () => {
    it('se relisent à l’identique, triées par personnage puis version', async () => {
      await seedWorld(h().storage);
      const rows = [
        visual(C.sarah, 2),
        visual(C.alexandre, 1, { visualDescription: null, voiceId: null, referenceImages: [] }),
        visual(C.sarah, 1, { wardrobeId: 'garde-robe-3' }),
      ];
      for (const r of rows) await h().storage.tx((s) => s.characterVisuals.insert(r));
      const read = await h().storage.tx((s) => s.characterVisuals.listByWorld(IDS.world));
      expect(read).toEqual([rows[1], rows[2], rows[0]]); // alexandre v1, sarah v1, sarah v2
      expect(await h().storage.tx((s) => s.characterVisuals.listByWorld(IDS.otherWorld))).toEqual([]);
    });

    it('refuse une version en double et un personnage inconnu', async () => {
      await seedWorld(h().storage);
      await h().storage.tx((s) => s.characterVisuals.insert(visual(C.sarah, 1)));
      await expectCode(
        h().storage.tx((s) => s.characterVisuals.insert(visual(C.sarah, 1))),
        'DUPLICATE',
      );
      await expectCode(
        h().storage.tx((s) => s.characterVisuals.insert(visual(fixedId(0x30, 99), 1))),
        'NOT_FOUND',
      );
    });
  });
}
