/** Collecte : tout ce que la narration lit d'une époque terminée (lecture seule). */
import { DomainError } from '@ai-reality/engine';
import type { EffectRecord, Id } from '@ai-reality/engine';
import type { NarrativeStoragePort } from './ports.js';
import type { EpochDigest, StateDiffEntry } from './types.js';

/** Somme des effets par (cible, personnage, autre, dimension), dans l'ordre de première apparition. */
export function stateDiffOf(effects: readonly EffectRecord[]): StateDiffEntry[] {
  const diff = new Map<string, StateDiffEntry>();
  for (const e of effects) {
    const key = [e.targetKind, e.characterId, e.otherCharacterId ?? '', e.dimension].join('|');
    const prev = diff.get(key);
    diff.set(key, {
      targetKind: e.targetKind,
      characterId: e.characterId,
      otherCharacterId: e.otherCharacterId,
      dimension: e.dimension,
      delta: (prev?.delta ?? 0) + e.delta,
      valueAfter: e.valueAfter ?? prev?.valueAfter ?? null,
    });
  }
  return [...diff.values()];
}

export async function collectDigest(storage: NarrativeStoragePort, epochId: Id): Promise<EpochDigest> {
  const epoch = await storage.sim.epoch(epochId);
  if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${epochId} inconnue`);
  if (epoch.status !== 'completed') {
    throw new DomainError(
      'EPOCH_NOT_COMPLETED',
      `L'époque ${String(epoch.number)} n'est pas terminée (${epoch.status})`,
    );
  }
  const [journal, worldEvents, characters, openArcs] = await Promise.all([
    storage.sim.journal(epochId),
    storage.sim.eventsOfWorld(epoch.worldId),
    storage.sim.characters(epoch.worldId),
    storage.episodes.openArcs(epoch.worldId),
  ]);
  const causes: Record<Id, Id | null> = {};
  for (const e of worldEvents) causes[e.id] = e.causedByEventId;

  return {
    worldId: epoch.worldId,
    epochId,
    epochNumber: epoch.number,
    events: journal.events,
    effects: journal.effects,
    stateDiff: stateDiffOf(journal.effects),
    scenes: journal.scenes,
    presences: journal.presences,
    interactions: journal.interactions,
    utterances: journal.utterances,
    characters: characters.map((c) => ({ id: c.id, firstName: c.firstName, autonomy: c.autonomy })),
    playerCharacterIds: characters.filter((c) => c.autonomy !== 'autonomous').map((c) => c.id),
    openArcs,
    causes,
  };
}
