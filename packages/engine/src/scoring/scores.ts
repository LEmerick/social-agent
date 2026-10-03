/**
 * Scores (engine-architecture.md §9) : S = Σ poids × impact. Chaque effet `score` produit une `ScoreEntryRecord`
 * qui fige le poids de la saison au moment de l'event ; `recomputeScores` recalcule tout quand les poids changent.
 */
import type { IdFactory } from '../core/id.js';
import type { EffectRecord, ScoreEntryRecord } from '../state/journal.js';
import { SCORE_NAMES, type Id, type ScoreName, type SimState } from '../state/types.js';

export type ScoreWeights = Readonly<Record<ScoreName, number>>;

export interface ScoreSummary {
  /** Σ poids × impact par score. */
  readonly perScore: Readonly<Record<ScoreName, number>>;
  readonly total: number;
}

const isScoreName = (d: string): d is ScoreName => (SCORE_NAMES as readonly string[]).includes(d);

/** Une entrée de score par effet `score`, avec le poids courant de la saison. */
export function scoreEntriesFor(
  state: Readonly<SimState>,
  effects: readonly EffectRecord[],
  ids: IdFactory,
): ScoreEntryRecord[] {
  const weights = state.season.rules.scoreWeights;
  return effects
    .filter((fx) => fx.targetKind === 'score' && isScoreName(fx.dimension))
    .map((fx) => ({
      id: ids.next(),
      characterId: fx.characterId,
      epochId: fx.epochId,
      eventId: fx.eventId,
      score: fx.dimension as ScoreName,
      weight: weights[fx.dimension as ScoreName],
      impact: fx.delta,
      ruleId: fx.ruleId,
    }));
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

const emptyPerScore = (): Record<ScoreName, number> =>
  Object.fromEntries(SCORE_NAMES.map((n) => [n, 0])) as Record<ScoreName, number>;

/**
 * Recalcule les scores par personnage. Avec `weights`, les poids stockés dans les entrées sont remplacés
 * (changement de pondération de la saison) ; sans, les poids figés au moment des events sont conservés.
 * Renvoie les entrées re-pondérées (à réécrire en stockage) et la synthèse par personnage.
 */
export function recomputeScores(
  entries: readonly ScoreEntryRecord[],
  weights?: ScoreWeights,
): { entries: ScoreEntryRecord[]; byCharacter: Record<Id, ScoreSummary> } {
  const reweighted = entries.map((e) => (weights ? { ...e, weight: weights[e.score] } : e));
  const acc: Record<Id, Record<ScoreName, number>> = {};
  for (const e of reweighted) {
    const perScore = (acc[e.characterId] ??= emptyPerScore());
    perScore[e.score] += e.weight * e.impact;
  }
  const byCharacter: Record<Id, ScoreSummary> = {};
  for (const [id, perScore] of Object.entries(acc)) {
    const rounded = Object.fromEntries(SCORE_NAMES.map((n) => [n, round6(perScore[n])])) as Record<ScoreName, number>;
    byCharacter[id] = { perScore: rounded, total: round6(SCORE_NAMES.reduce((t, n) => t + perScore[n], 0)) };
  }
  return { entries: reweighted, byCharacter };
}
