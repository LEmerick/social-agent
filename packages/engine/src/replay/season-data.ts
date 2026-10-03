/**
 * Lecture du journal d'une saison : tout ce que le rejeu, l'audit et le recalcul ont besoin de relire,
 * en une seule transaction (lecture cohérente).
 */
import { DomainError } from '../core/errors.js';
import type {
  CharacterRecord,
  EpochJournal,
  EpochRecord,
  SeasonRecord,
  StoragePort,
  WorldRecord,
} from '../ports/storage.js';
import { mergeWorldConfig } from '../state/load.js';
import type { CharacterStateRecord, EventRecord } from '../state/journal.js';
import type { FactNode, Id, KnowledgeEdge, RelationshipEdge, WorldConfig } from '../state/types.js';

/** Une époque de la saison avec son journal et ses projections figées. */
export interface EpochData {
  readonly epoch: EpochRecord;
  readonly journal: EpochJournal;
  /** Lignes `character_state` de l'époque (triées par personnage). */
  readonly states: readonly CharacterStateRecord[];
  /** Relations figées à la clôture (vide tant que l'époque n'est pas terminée). */
  readonly snapshot: readonly RelationshipEdge[];
}

/** L'époque qui précède la première époque de la saison (point de départ du rejeu), si elle existe. */
export interface PreviousEpoch {
  readonly epoch: EpochRecord;
  readonly states: readonly CharacterStateRecord[];
  readonly snapshot: readonly RelationshipEdge[];
}

export interface SeasonData {
  readonly world: WorldRecord;
  readonly season: SeasonRecord;
  readonly config: WorldConfig;
  readonly characters: readonly CharacterRecord[];
  /** Époques de la saison, par numéro croissant. */
  readonly epochs: readonly EpochData[];
  readonly previous: PreviousEpoch | null;
  /** Vrai si la dernière époque du monde est celle de cette saison : les projections vivantes la reflètent alors. */
  readonly current: boolean;
  /** Identifiants d'époque référencés par des events mais sans enregistrement d'époque (journal orphelin). */
  readonly danglingEpochIds: readonly Id[];
  /** Tous les events du monde, par `seq`. */
  readonly events: readonly EventRecord[];
  readonly facts: readonly FactNode[];
  readonly knowledge: readonly KnowledgeEdge[];
}

/** Relit la saison `seasonNumber` du monde `worldId`. Monde ou saison inconnus ⇒ `NOT_FOUND`. */
export function loadSeasonData(storage: StoragePort, worldId: Id, seasonNumber: number): Promise<SeasonData> {
  return storage.tx(async (s) => {
    const world = await s.worlds.findById(worldId);
    if (!world) throw new DomainError('NOT_FOUND', `Monde ${worldId} introuvable`);
    const season = await s.seasons.findByNumber(worldId, seasonNumber);
    if (!season)
      throw new DomainError('NOT_FOUND', `Saison ${String(seasonNumber)} introuvable dans le monde ${worldId}`);

    const worldEpochs: EpochRecord[] = [];
    for (let n = 0; ; n++) {
      const epoch = await s.epochs.findByNumber(worldId, n);
      if (!epoch) break;
      worldEpochs.push(epoch);
    }
    const mine = worldEpochs.filter((e) => e.seasonId === season.id);
    const first = mine[0];
    const before = first ? worldEpochs.find((e) => e.number === first.number - 1) : undefined;

    const epochs: EpochData[] = [];
    for (const epoch of mine) {
      epochs.push({
        epoch,
        journal: await s.journal.read(epoch.id),
        states: await s.characterStates.listByEpoch(epoch.id),
        snapshot: await s.snapshots.relationships(epoch.id),
      });
    }

    const events = await s.journal.eventsOfWorld(worldId);
    const known = new Set(worldEpochs.map((e) => e.id));
    const danglingEpochIds: Id[] = [];
    for (const epochId of new Set(events.map((e) => e.epochId))) {
      if (!known.has(epochId)) danglingEpochIds.push(epochId);
    }

    return {
      world,
      season,
      config: mergeWorldConfig(world.config),
      characters: await s.characters.listByWorld(worldId),
      epochs,
      current: mine.length > 0 && mine[mine.length - 1]?.id === worldEpochs[worldEpochs.length - 1]?.id,
      previous: before
        ? {
            epoch: before,
            states: await s.characterStates.listByEpoch(before.id),
            snapshot: await s.snapshots.relationships(before.id),
          }
        : null,
      danglingEpochIds,
      events,
      facts: await s.facts.listByWorld(worldId),
      knowledge: await s.knowledge.listByWorld(worldId),
    };
  });
}
