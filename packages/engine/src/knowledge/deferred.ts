/**
 * Intentions différées (engine-architecture.md §6, phase 3.f) : un personnage qui apprend un fait sensible
 * veut le raconter à un allié probable. C'est le moteur des chaînes A → B → C → D.
 */
import { relOf } from '../rules/preconditions.js';
import type { FactNode, Id, Intention, SimState } from '../state/types.js';
import { knows } from './query.js';

/** Sensibilité minimale d'un fait pour déclencher une intention `tell`. */
export const TELL_MIN_SENSITIVITY = 2;
/** Un allié probable : alliance ≥ 50 ou confiance ≥ 60 (du point de vue de celui qui sait). */
export const ALLY_MIN_ALLIANCE = 50;
export const ALLY_MIN_TRUST = 60;

export interface AgendaAddition {
  readonly characterId: Id;
  readonly intention: Intention;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const trait = (state: Readonly<SimState>, id: Id, name: string): number => state.characters[id]?.traits[name] ?? 50;

/** Force du lien apprenant → allié, 0..1 : le meilleur de l'alliance et de la confiance. */
export const bondStrength = (state: Readonly<SimState>, learnerId: Id, allyId: Id): number => {
  const e = relOf(state, learnerId, allyId);
  return Math.max(e.alliance, e.trust) / 100;
};

/**
 * Priorité (0..1) de « raconter ce fait à cet allié » :
 *
 *   0,15 + 0,25 × (sensibilité / 3) + 0,30 × lien + 0,20 × (sociabilité / 100) − 0,15 × (loyauté / 100)
 *
 * borné à [0,05 ; 1]. `lien` = max(alliance, confiance) / 100 de l'apprenant vers l'allié. Un fait plus
 * sensible, un lien plus fort et un tempérament sociable poussent à raconter ; la loyauté (discrétion) freine.
 * Traits absents : 50.
 */
export function tellPriority(state: Readonly<SimState>, learnerId: Id, allyId: Id, sensitivity: number): number {
  const sociability = trait(state, learnerId, 'sociability') / 100;
  const loyalty = trait(state, learnerId, 'loyalty') / 100;
  const raw = 0.15 + 0.25 * (sensitivity / 3) + 0.3 * bondStrength(state, learnerId, allyId) + 0.2 * sociability;
  return Math.min(1, Math.max(0.05, raw - 0.15 * loyalty));
}

const inGame = (state: Readonly<SimState>, id: Id): boolean => {
  const c = state.characters[id];
  return c !== undefined && c.status !== 'eliminated' && c.status !== 'paused';
};

/**
 * Intention `tell` que `learnerId` formerait après avoir appris `fact` de `fromId` (null : témoin direct), ou `null`.
 * Allié candidat : en jeu, alliance ≥ 50 ou confiance ≥ 60, hors apprenant, émetteur, sujet du fait, et personnes
 * qui connaissent déjà le fait ou l'apprennent en même temps (`exclude`). On retient celui de plus haute priorité (à égalité, l'identifiant le plus petit).
 * Aucune intention si le fait est peu sensible, si l'apprenant en est le sujet ou ne le croit pas.
 */
export function deferredTell(
  state: Readonly<SimState>,
  learnerId: Id,
  fact: FactNode,
  fromId: Id | null,
  believed = true,
  exclude: ReadonlySet<Id> = new Set(),
): Intention | null {
  if (fact.sensitivity < TELL_MIN_SENSITIVITY || !believed || fact.subjectId === learnerId) return null;
  const agenda = state.characters[learnerId]?.agenda ?? [];
  let best: { id: Id; priority: number } | undefined;
  for (const allyId of Object.keys(state.characters).sort()) {
    if (allyId === learnerId || allyId === fromId || allyId === fact.subjectId || exclude.has(allyId)) continue;
    if (!inGame(state, allyId) || knows(state, allyId, fact.id)) continue;
    const e = relOf(state, learnerId, allyId);
    if (e.alliance < ALLY_MIN_ALLIANCE && e.trust < ALLY_MIN_TRUST) continue;
    if (agenda.some((i) => i.kind === 'tell' && i.targetId === allyId && i.factId === fact.id)) continue;
    const priority = tellPriority(state, learnerId, allyId, fact.sensitivity);
    if (!best || priority > best.priority) best = { id: allyId, priority };
  }
  if (!best) return null;
  return {
    kind: 'tell',
    targetId: best.id,
    goal: null,
    factId: fact.id,
    locationId: null,
    priority: clamp01(best.priority),
  };
}
