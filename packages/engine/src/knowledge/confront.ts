/**
 * Confrontation au sujet d'un fait (règle `confront_betrayal@1`).
 *
 * Quand l'accusateur confronte la cible avec un fait qui la concerne, la cible apprend d'où il le tient : la chaîne de
 * provenance de l'accusateur (`provenance`). Le traître est le premier maillon qui a raconté le fait (le `told_by` de
 * la plus ancienne connaissance transmise de la chaîne), à condition que :
 * - le fait concerne la cible (elle en est le sujet ou l'objet) ;
 * - ce traître ne soit ni la cible ni l'accusateur ;
 * - la cible ait un lien avec lui : alliance > 0 ou confiance ≥ 60.
 *
 * Alors l'alliance se retourne en rivalité, du point de vue de la cible (celle qui apprend la trahison) :
 *   cible→traître : alliance ramenée à 0, rivalité +50 (donc étiquette `rival`), confiance −25, respect −10 ;
 *   traître→cible : alliance ramenée à 0, rivalité +15, confiance −10 (rancune réciproque, plus faible : il ignore l'accusation).
 * Ces effets s'ajoutent à ceux de `confront` / `accuse` (rivalité, confiance) et ne s'appliquent que pour les issues
 * `escalated` et `accepted` : si la cible esquive (`deflected`) ou si l'accusation se retourne (`backfired`), rien n'est établi.
 */
import { relOf } from '../rules/preconditions.js';
import type { EffectInput } from '../state/journal.js';
import type { Id, SimState } from '../state/types.js';
import { ALLY_MIN_TRUST } from './deferred.js';
import { provenance } from './query.js';

export const BETRAYAL_RULE = { id: 'confront_betrayal', version: 1 } as const;
export const BETRAYAL_OUTCOMES: ReadonlySet<string> = new Set(['escalated', 'accepted']);

/** Chaîne de provenance de l'accusateur, de l'origine à lui : ce que la cible apprend en étant confrontée. */
export const provenanceSummary = (
  state: Readonly<SimState>,
  accuserId: Id,
  factId: Id,
): { characterId: Id; source: string; toldById: Id | null }[] =>
  provenance(state, accuserId, factId).map((k) => ({
    characterId: k.characterId,
    source: k.sourceType,
    toldById: k.toldById,
  }));

/** Le traître que la confrontation désigne, ou `null`. */
export function identifyTraitor(state: Readonly<SimState>, accuserId: Id, targetId: Id, factId: Id): Id | null {
  const fact = state.facts[factId];
  if (!fact || (fact.subjectId !== targetId && fact.objectId !== targetId)) return null;
  const leaker = provenance(state, accuserId, factId).find((k) => k.toldById !== null)?.toldById ?? null;
  if (leaker === null || leaker === targetId || leaker === accuserId) return null;
  const bond = relOf(state, targetId, leaker);
  return bond.alliance > 0 || bond.trust >= ALLY_MIN_TRUST ? leaker : null;
}

const fx = (from: Id, to: Id, dimension: string, delta: number, traitorId: Id): EffectInput => ({
  targetKind: 'relationship',
  characterId: from,
  otherCharacterId: to,
  dimension,
  delta,
  ruleId: BETRAYAL_RULE.id,
  ruleVersion: BETRAYAL_RULE.version,
  reason: `traître identifié : ${traitorId}`,
});

/** Effets de relation du retournement d'alliance ; vide si aucun traître n'est identifié ou si l'issue n'établit rien. */
export function betrayalEffects(
  state: Readonly<SimState>,
  accuserId: Id,
  targetId: Id,
  factId: Id,
  outcome: string,
): { traitorId: Id; effects: EffectInput[] } | null {
  if (!BETRAYAL_OUTCOMES.has(outcome)) return null;
  const traitorId = identifyTraitor(state, accuserId, targetId, factId);
  if (traitorId === null) return null;
  const forth = relOf(state, targetId, traitorId);
  const back = relOf(state, traitorId, targetId);
  const effects = [
    fx(targetId, traitorId, 'alliance', -forth.alliance, traitorId),
    fx(targetId, traitorId, 'rivalry', 50, traitorId),
    fx(targetId, traitorId, 'trust', -25, traitorId),
    fx(targetId, traitorId, 'respect', -10, traitorId),
    fx(traitorId, targetId, 'alliance', -back.alliance, traitorId),
    fx(traitorId, targetId, 'rivalry', 15, traitorId),
    fx(traitorId, targetId, 'trust', -10, traitorId),
  ].filter((e) => e.delta !== 0);
  return { traitorId, effects };
}
