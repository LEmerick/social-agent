import { DomainError } from '@ai-reality/engine';
import type { Id, StoragePort } from '@ai-reality/engine';
import type { EpisodeRecord, EpisodeStatus, EpisodeStore, NarrativeStoragePort } from '../ports.js';
import type { NarrativeArc, ValidationIssue } from '../types.js';
import { simulationReader } from './reader.js';

/** Tables `episode*` en mémoire. Même comportement observable que l'adaptateur SQL (suite de contrat commune). */
export function memoryEpisodeStore(): EpisodeStore & { reset(): void } {
  let episodes = new Map<Id, EpisodeRecord>();
  let arcs = new Map<Id, NarrativeArc>();

  return {
    reset() {
      episodes = new Map();
      arcs = new Map();
    },

    saveEpisode(episode) {
      for (const e of episodes.values()) {
        if (e.id === episode.id || (e.epochId === episode.epochId && e.version === episode.version)) {
          return Promise.reject(
            new DomainError('DUPLICATE', `Épisode déjà enregistré (${episode.epochId} v${String(episode.version)})`),
          );
        }
      }
      episodes.set(episode.id, structuredClone({ ...episode, arcIds: [...episode.arcIds].sort() }));
      return Promise.resolve();
    },

    setStatus(episodeId: Id, status: EpisodeStatus, issues: readonly ValidationIssue[], durationSeconds: number) {
      const found = episodes.get(episodeId);
      if (!found) return Promise.reject(new DomainError('NOT_FOUND', `Épisode ${episodeId} inconnu`));
      episodes.set(episodeId, structuredClone({ ...found, status, issues, durationSeconds }));
      return Promise.resolve();
    },

    upsertArcs(list) {
      for (const arc of list) arcs.set(arc.id, structuredClone(arc));
      return Promise.resolve();
    },

    openArcs(worldId) {
      const open = [...arcs.values()].filter((a) => a.worldId === worldId && a.status === 'open');
      return Promise.resolve(structuredClone(open.sort((a, b) => (a.id < b.id ? -1 : 1))));
    },

    episodes(worldId) {
      const list = [...episodes.values()].filter((e) => e.worldId === worldId);
      list.sort((a, b) => a.number - b.number || a.version - b.version);
      return Promise.resolve(structuredClone(list));
    },
  };
}

/** Narration en mémoire : lecture d'un `StoragePort` existant, écriture dans des tables `episode*` à part. */
export function memoryNarrativeStorage(storage: StoragePort): NarrativeStoragePort & { reset(): void } {
  const episodes = memoryEpisodeStore();
  return {
    sim: simulationReader(storage),
    episodes,
    reset: () => {
      episodes.reset();
    },
  };
}
