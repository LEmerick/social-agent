/**
 * Recalcul des scores d'une saison après un changement de règles (engine-architecture.md §9).
 * Réutilise `ScoringService` pour chaque époque (re-pondération des entrées), puis rétablit les scores cumulés
 * de chaque `character_state` : le moteur écrit des scores cumulés sur toute la saison, `ScoringService` seul
 * n'additionne que les entrées de l'époque.
 */
import { DomainError } from '../core/errors.js';
import type { EpochRecord, StoragePort } from '../ports/storage.js';
import { type ScoreSummary, type ScoreWeights, recomputeScores } from '../scoring/scores.js';
import { ScoringService } from '../scoring/service.js';
import type { ScoreEntryRecord } from '../state/journal.js';
import type { Id } from '../state/types.js';

export interface RecomputeSeasonResult {
  readonly seasonId: Id;
  readonly rulesVersion: number;
  readonly weights: ScoreWeights | null;
  /** Époques recalculées, par numéro. */
  readonly epochs: readonly { readonly epochId: Id; readonly number: number; readonly entries: number }[];
  /** Scores cumulés en fin de saison. */
  readonly byCharacter: Readonly<Record<Id, ScoreSummary>>;
}

/**
 * Recalcule toutes les époques de la saison avec `season.rules.scoreWeights`. Si `rulesVersion` est fourni, la saison
 * doit être exactement à cette version (garde contre un recalcul avec des règles inattendues) : sinon
 * `RULES_VERSION_MISMATCH`.
 */
export async function recompute(
  storage: StoragePort,
  seasonId: Id,
  rulesVersion?: number,
): Promise<RecomputeSeasonResult> {
  const { season, epochs } = await storage.tx(async (s) => {
    const found = await s.seasons.findById(seasonId);
    if (!found) throw new DomainError('NOT_FOUND', `Saison ${seasonId} introuvable`);
    if (rulesVersion !== undefined && found.rulesVersion !== rulesVersion) {
      throw new DomainError(
        'RULES_VERSION_MISMATCH',
        `La saison est à la version de règles ${String(found.rulesVersion)}, pas ${String(rulesVersion)}`,
      );
    }
    const list: EpochRecord[] = [];
    for (let n = 0; ; n++) {
      const epoch = await s.epochs.findByNumber(found.worldId, n);
      if (!epoch) break;
      if (epoch.seasonId === found.id) list.push(epoch);
    }
    return { season: found, epochs: list };
  });

  let weights: ScoreWeights | null = null;
  for (const epoch of epochs) weights = (await ScoringService.recompute(storage, epoch.id)).weights;

  // Cumul : la ligne d'état de l'époque k porte la somme pondérée des entrées des époques 0..k.
  const { counts, byCharacter } = await storage.tx(async (s) => {
    const all: ScoreEntryRecord[] = [];
    const perEpoch = new Map<Id, number>();
    let summary: Record<Id, ScoreSummary> = {};
    for (const epoch of epochs) {
      const { scoreEntries } = await s.journal.read(epoch.id);
      perEpoch.set(epoch.id, scoreEntries.length);
      all.push(...scoreEntries);
      summary = recomputeScores(all).byCharacter;
      await s.characterStates.updateScores(
        epoch.id,
        Object.fromEntries(Object.entries(summary).map(([id, sum]) => [id, { ...sum.perScore }])),
      );
    }
    return { counts: perEpoch, byCharacter: summary };
  });

  return {
    seasonId: season.id,
    rulesVersion: season.rulesVersion,
    weights,
    epochs: epochs.map((e) => ({ epochId: e.id, number: e.number, entries: counts.get(e.id) ?? 0 })),
    byCharacter,
  };
}
