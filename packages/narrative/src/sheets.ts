/** Export des fiches `Scene` pour le Video Engine : lieu, personnages (+ version visuelle), ton, plans, dialogues. */
import type { CharacterVisualRecord, Id } from '@ai-reality/engine';
import { scriptOfRecord } from './episode-rows.js';
import type { EpisodeRecord } from './ports.js';
import type { Shot } from './script.js';

export interface CharacterVisualInfo {
  readonly version: number;
  readonly description: string | null;
  readonly referenceImages: readonly string[];
  readonly voiceId: string | null;
  readonly wardrobeId: string | null;
}

export interface SheetWorld {
  readonly characters: readonly { readonly id: Id; readonly firstName: string }[];
  readonly locations: readonly { readonly id: Id; readonly name: string; readonly visualRef: string | null }[];
  /** Versions visuelles (`character_visual`) : pour chaque personnage, la plus récente valable à l'époque de l'épisode. */
  readonly visuals?: readonly CharacterVisualRecord[];
}

export interface SceneSheet {
  readonly episodeId: Id;
  readonly number: number;
  readonly location: { readonly id: Id; readonly name: string; readonly visualRef: string | null };
  readonly characters: readonly {
    readonly id: Id;
    readonly name: string;
    readonly visual: CharacterVisualInfo | null;
  }[];
  readonly tone: string;
  readonly summary: string;
  readonly seconds: number;
  readonly shots: readonly Shot[];
  readonly dialogues: readonly {
    readonly kind: 'dialogue' | 'confessional' | 'voiceover';
    readonly speakerId: Id | null;
    readonly speakerName: string | null;
    readonly text: string;
    readonly tone: string | null;
  }[];
  readonly sources: readonly Id[];
}

/** Version visuelle en vigueur à l'époque `epochNumber` : la plus haute dont `validFromEpoch` ne dépasse pas l'époque. */
export function visualAt(
  visuals: readonly CharacterVisualRecord[],
  characterId: Id,
  epochNumber: number,
): CharacterVisualInfo | null {
  const valid = visuals
    .filter((v) => v.characterId === characterId && v.validFromEpoch <= epochNumber)
    .sort((a, b) => b.validFromEpoch - a.validFromEpoch || b.version - a.version)[0];
  return valid
    ? {
        version: valid.version,
        description: valid.visualDescription,
        referenceImages: [...valid.referenceImages],
        voiceId: valid.voiceId,
        wardrobeId: valid.wardrobeId,
      }
    : null;
}

export function sceneSheetsOf(episode: EpisodeRecord, world: SheetWorld): SceneSheet[] {
  const nameOf = new Map(world.characters.map((c) => [c.id, c.firstName]));
  const locationOf = new Map(world.locations.map((l) => [l.id, l]));
  return scriptOfRecord(episode).scenes.map((scene, index) => {
    const location = locationOf.get(scene.locationId);
    return {
      episodeId: episode.id,
      number: index + 1,
      location: {
        id: scene.locationId,
        name: location?.name ?? scene.locationId,
        visualRef: location?.visualRef ?? null,
      },
      characters: scene.characterIds.map((id) => ({
        id,
        name: nameOf.get(id) ?? id,
        visual: visualAt(world.visuals ?? [], id, episode.number),
      })),
      tone: scene.tone,
      summary: scene.summary,
      seconds: scene.seconds,
      shots: scene.shots,
      dialogues: scene.lines.map((l) => ({
        kind: l.kind,
        speakerId: l.speakerId,
        speakerName: l.speakerId === null ? null : (nameOf.get(l.speakerId) ?? l.speakerId),
        text: l.text,
        tone: l.tone,
      })),
      sources: scene.sources,
    };
  });
}
