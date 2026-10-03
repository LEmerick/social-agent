/**
 * Contexte d'agent « tel qu'au début de l'arc » : les connaissances apprises à partir de ce moment sont retirées,
 * et les relations sont celles de la fin de l'époque précédente quand un instantané existe.
 * Lecture seule (aucune méthode d'écriture du `StoragePort` n'est appelée).
 */
import { DomainError, buildAgentContext, loadSimState, relKey } from '@ai-reality/engine';
import type { AgentContext, Id, StoragePort } from '@ai-reality/engine';
import type { NarrativeArc } from './types.js';

export function storageContextProvider(
  storage: StoragePort,
): (characterId: Id, about: NarrativeArc) => Promise<AgentContext> {
  return async (characterId, about) => {
    const loaded = await storage.tx(async (s) => {
      const epoch = await s.epochs.findById(about.firstEpochId);
      if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${about.firstEpochId} inconnue`);
      const season = await s.seasons.findById(epoch.seasonId);
      if (!season) throw new DomainError('NOT_FOUND', `Saison ${epoch.seasonId} inconnue`);
      const root = (await s.journal.eventsOfWorld(about.worldId)).find((e) => e.id === about.rootEventId);
      const previous = epoch.number > 0 ? await s.epochs.findByNumber(epoch.worldId, epoch.number - 1) : undefined;
      const snapshot = previous ? await s.snapshots.relationships(previous.id) : [];
      return { epoch, season, rootTick: root?.tick ?? 0, snapshot };
    });
    const state = await loadSimState(storage, about.worldId, loaded.season.number, {
      epochNumber: loaded.epoch.number,
    });

    // Seul ce que le personnage savait avant l'arc.
    const start = loaded.epoch.number * 1_000_000 + loaded.rootTick;
    state.knowledge = Object.fromEntries(
      Object.entries(state.knowledge).filter(([, edge]) => edge.learnedEpoch * 1_000_000 + edge.learnedTick < start),
    );
    if (loaded.snapshot.length > 0) {
      state.relationships = Object.fromEntries(loaded.snapshot.map((e) => [relKey(e.sourceId, e.targetId), e]));
    }

    const confessional = Object.values(state.locations).find((l) => l.kind === 'confessional');
    return buildAgentContext(state, characterId, {
      locationId: confessional?.id ?? null,
      sceneMemberIds: [],
      previousTurns: [],
    });
  };
}
