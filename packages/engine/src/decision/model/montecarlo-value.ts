/**
 * Valeur d'un futur simulé pour l'acteur (decision-model.md §5.3) : écart entre l'état final du rollout et l'état de
 * départ, pondéré par les objectifs et le tempérament de l'acteur.
 *
 *   V = wInfl × Δinfluence + wScore × Δ(Σ poids de saison × scores) + wAlly × Σ Δalliance(A→X) / 20
 *       + wTrust × Σ Δconfiance(X→A) / 20 − wRiv × Σ Δrivalité(X→A) / 20 + 0,2 × Δmoral / 10 + 0,5 × Δénergie / 10
 *       − 5 × [solde sous le seuil de restriction]
 *
 * wInfl = 0,5 + ambition ; wScore = 0,3 + ambition / 2 ; wAlly = 0,5 + loyauté ; wTrust = 0,5 + coopération ;
 * wRiv = 0,5 + (1 − compétitivité).
 */
import { AXIS_DEFAULTS, SCORE_NAMES, type Id, type SimState, relKey } from '../../state/types.js';
import { weightsOf } from './weights.js';

export function valueFor(before: Readonly<SimState>, after: Readonly<SimState>, actorId: Id): number {
  const a0 = before.characters[actorId];
  const a1 = after.characters[actorId];
  if (!a0 || !a1) return 0;
  const w = weightsOf(a0);
  const weights = before.season.rules.scoreWeights;

  const dInfluence = a1.stats.influence - a0.stats.influence;
  const dScore = SCORE_NAMES.reduce((s, n) => s + weights[n] * (a1.scores[n] - a0.scores[n]), 0);

  // Une seule passe sur les arêtes qui touchent l'acteur ; une arête absente au départ vaut les axes par défaut.
  let dAlliance = 0;
  let dTrust = 0;
  let dRival = 0;
  for (const e of Object.values(after.relationships)) {
    const out = e.sourceId === actorId;
    if (!out && e.targetId !== actorId) continue;
    const was = before.relationships[relKey(e.sourceId, e.targetId)];
    if (out) dAlliance += e.alliance - (was?.alliance ?? AXIS_DEFAULTS.alliance);
    else {
      dTrust += e.trust - (was?.trust ?? AXIS_DEFAULTS.trust);
      dRival += e.rivalry - (was?.rivalry ?? AXIS_DEFAULTS.rivalry);
    }
  }

  const rules = before.season.rules.economy;
  const restricted = rules.enabled && a1.credits < rules.restrictedThreshold && a0.credits >= rules.restrictedThreshold;
  return (
    (0.5 + w.ambitionDrive) * dInfluence +
    (0.3 + w.ambitionDrive / 2) * dScore +
    ((0.5 + w.allyBonus) * dAlliance) / 20 +
    ((0.5 + w.cooperationBias) * dTrust) / 20 -
    ((0.5 + (1 - w.rivalryDrive)) * dRival) / 20 +
    (0.2 * (a1.stats.morale - a0.stats.morale)) / 10 +
    (0.5 * (a1.stats.energy - a0.stats.energy)) / 10 -
    (restricted ? 5 : 0)
  );
}
