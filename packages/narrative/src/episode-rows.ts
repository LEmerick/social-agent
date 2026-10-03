/** Passage script ⇄ lignes de tables (`episode_scene`, `episode_line`). Les ids dérivent de l'épisode : rejouable. */
import { deriveUuid } from '@ai-reality/engine';
import type { Id } from '@ai-reality/engine';
import type { EpisodeScript } from './script.js';
import type { EpisodeLineRecord, EpisodeRecord, EpisodeSceneRecord } from './ports.js';

export const episodeId = (epochId: Id, version: number): Id => deriveUuid(`episode:${epochId}:${String(version)}`);

export function rowsOfScript(
  episodeId: Id,
  script: EpisodeScript,
): { scenes: EpisodeSceneRecord[]; lines: EpisodeLineRecord[] } {
  const scenes: EpisodeSceneRecord[] = [];
  const lines: EpisodeLineRecord[] = [];
  script.scenes.forEach((scene, seq) => {
    const id = deriveUuid(`${episodeId}:scene:${String(seq)}`);
    scenes.push({
      id,
      episodeId,
      seq,
      locationId: scene.locationId,
      tone: scene.tone,
      summary: scene.summary,
      seconds: scene.seconds,
      characterIds: [...scene.characterIds],
      sourceEventIds: [...scene.sources],
      shots: scene.shots.map((s) => ({ ...s, characterIds: [...s.characterIds] })),
      claims: scene.claims.map((c) => ({ ...c })),
    });
    scene.lines.forEach((line, lineSeq) => {
      lines.push({
        ...line,
        id: deriveUuid(`${id}:line:${String(lineSeq)}`),
        episodeId,
        sceneId: id,
        seq: lineSeq,
        llmCallId: null,
      });
    });
  });
  return { scenes, lines };
}

/** Reconstitue le script d'un épisode stocké (scènes et lignes dans l'ordre de `seq`). */
export function scriptOfRecord(episode: EpisodeRecord): EpisodeScript {
  const scenes = [...episode.scenes].sort((a, b) => a.seq - b.seq);
  return {
    title: episode.title,
    synopsis: episode.synopsis,
    cliffhanger: episode.cliffhanger,
    scenes: scenes.map((scene) => ({
      locationId: scene.locationId,
      characterIds: [...scene.characterIds],
      tone: scene.tone,
      summary: scene.summary,
      seconds: scene.seconds,
      sources: [...scene.sourceEventIds],
      shots: scene.shots.map((s) => ({ ...s, characterIds: [...s.characterIds] })),
      claims: scene.claims.map((c) => ({ ...c })),
      lines: episode.lines
        .filter((l) => l.sceneId === scene.id)
        .sort((a, b) => a.seq - b.seq)
        .map((l) => ({
          kind: l.kind,
          speakerId: l.speakerId,
          text: l.text,
          utteranceId: l.utteranceId,
          tone: l.tone,
        })),
    })),
  };
}
