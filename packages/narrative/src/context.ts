/**
 * Contexte d'agent « tel qu'avant le dénouement de l'arc » : le personnage ne sait que ce qu'il a appris avant le
 * dernier event de l'arc (la confrontation à venir lui est inconnue). Les connaissances plus tardives sont retirées ;
 * les relations sont celles de la fin de l'époque, remontées en annulant les effets du dernier event et des suivants.
 * Lecture seule (aucune méthode d'écriture du `StoragePort` n'est appelée).
 */
import { DomainError, buildAgentContext, loadSimState, relKey } from '@ai-reality/engine';
import type { AgentContext, Axis, EffectRecord, Id, RelationshipEdge, StoragePort } from '@ai-reality/engine';
import type { NarrativeArc } from './types.js';

const SCALE = 1_000_000;

/**
 * Valeur des relations juste avant `fromTick` : pour chaque (source, cible, dimension), la valeur avant le premier
 * effet à partir de ce tick (`valueAfter - delta`). Les étiquettes ne se remontent pas : elles sont vidées sur les
 * arêtes touchées (mieux vaut en perdre que laisser fuiter la suite).
 */
export function relationshipsBefore(
  current: Readonly<Record<string, RelationshipEdge>>,
  effects: readonly EffectRecord[],
  fromTick: number,
): Record<string, RelationshipEdge> {
  const result = structuredClone(current) as Record<string, RelationshipEdge>;
  const seen = new Set<string>();
  for (const e of effects) {
    if (e.targetKind !== 'relationship' || e.otherCharacterId === null || e.tick < fromTick) continue;
    const key = relKey(e.characterId, e.otherCharacterId);
    const edge = result[key];
    const dimension = `${key}|${e.dimension}`;
    if (!edge || seen.has(dimension) || e.valueAfter === null) continue;
    seen.add(dimension);
    (edge as unknown as Record<Axis, number>)[e.dimension as Axis] = e.valueAfter - e.delta;
    result[key] = { ...edge, labels: [] };
  }
  return result;
}

export function storageContextProvider(
  storage: StoragePort,
): (characterId: Id, about: NarrativeArc) => Promise<AgentContext> {
  return async (characterId, about) => {
    const loaded = await storage.tx(async (s) => {
      const epoch = await s.epochs.findById(about.lastEpochId);
      if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${about.lastEpochId} inconnue`);
      const season = await s.seasons.findById(epoch.seasonId);
      if (!season) throw new DomainError('NOT_FOUND', `Saison ${epoch.seasonId} inconnue`);
      const journal = await s.journal.read(epoch.id);
      const ticks = journal.events.filter((e) => about.eventIds.includes(e.id)).map((e) => e.tick);
      return { epoch, season, effects: journal.effects, endTick: ticks.length > 0 ? Math.max(...ticks) : 0 };
    });
    const state = await loadSimState(storage, about.worldId, loaded.season.number, {
      epochNumber: loaded.epoch.number,
    });

    // Seul ce que le personnage savait avant le dernier event de l'arc.
    const end = loaded.epoch.number * SCALE + loaded.endTick;
    state.knowledge = Object.fromEntries(
      Object.entries(state.knowledge).filter(([, edge]) => edge.learnedEpoch * SCALE + edge.learnedTick < end),
    );
    state.relationships = relationshipsBefore(state.relationships, loaded.effects, loaded.endTick);

    const confessional = Object.values(state.locations).find((l) => l.kind === 'confessional');
    return buildAgentContext(state, characterId, {
      locationId: confessional?.id ?? null,
      sceneMemberIds: [],
      previousTurns: [],
    });
  };
}
