/**
 * Service de scores : recalcul d'une époque quand les poids de la saison changent (engine-architecture.md §9).
 * S = Σ poids × impact, sur les `ScoreEntryRecord` de l'époque.
 */
import { DomainError } from '../core/errors.js';
import type { StoragePort } from '../ports/storage.js';
import { DEFAULT_SEASON_RULES, type Id, SCORE_NAMES, type ScoreName } from '../state/types.js';
import { type ScoreSummary, type ScoreWeights, recomputeScores } from './scores.js';

export interface RecomputeResult {
  readonly weights: ScoreWeights;
  readonly byCharacter: Readonly<Record<Id, ScoreSummary>>;
}

/** Poids lus dans `season.rules.scoreWeights`, complétés par les défauts. */
function weightsOf(rules: Readonly<Record<string, unknown>>): ScoreWeights {
  const raw = (rules['scoreWeights'] ?? {}) as Partial<Record<ScoreName, unknown>>;
  return Object.fromEntries(
    SCORE_NAMES.map((n) => [n, typeof raw[n] === 'number' ? raw[n] : DEFAULT_SEASON_RULES.scoreWeights[n]]),
  ) as ScoreWeights;
}

export const ScoringService = {
  /**
   * Relit les entrées de score de l'époque, les re-pondère (par défaut avec `season.rules.scoreWeights` relus en base),
   * réécrit les poids et met à jour les scores des `characterStates` de l'époque. Les personnages sans entrée gardent
   * leurs scores. Une seule transaction.
   */
  recompute(storage: StoragePort, epochId: Id, weights?: ScoreWeights): Promise<RecomputeResult> {
    return storage.tx(async (s) => {
      const epoch = await s.epochs.findById(epochId);
      if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${epochId} introuvable`);
      const season = await s.seasons.findById(epoch.seasonId);
      if (!season) throw new DomainError('NOT_FOUND', `Saison ${epoch.seasonId} introuvable`);

      const applied = weights ?? weightsOf(season.rules);
      const { scoreEntries } = await s.journal.read(epochId);
      const { byCharacter } = recomputeScores(scoreEntries, applied);

      await s.journal.reweighScoreEntries(epochId, applied);
      await s.characterStates.updateScores(
        epochId,
        Object.fromEntries(Object.entries(byCharacter).map(([id, summary]) => [id, { ...summary.perScore }])),
      );
      return { weights: applied, byCharacter };
    });
  },
};
