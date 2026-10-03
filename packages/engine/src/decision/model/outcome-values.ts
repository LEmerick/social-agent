/**
 * Valence des issues, du point de vue de l'acteur : −1 (désastre) … +1 (succès plein).
 * Sert à l'utilité espérée (`utility.ts`) et à la définition du « succès » des options chiffrées.
 */
import { actionDef } from '../../rules/catalog.js';

const VALENCE: Readonly<Record<string, number>> = {
  accepted: 1,
  accepted_conditional: 0.6,
  believed: 1,
  doubted: 0.3,
  disbelieved: -0.3,
  deflected: 0,
  refused: -0.4,
  backfired: -1,
  escalated: -0.7,
  won: 1,
  draw: 0.2,
  lost: -0.6,
  detected: -0.8,
  undetected: 1,
  found: 1,
  found_clue: 0.5,
  not_found: -0.1,
};

/** Pour une provocation, l'escalade est le but : elle vaut mieux qu'une esquive. */
const HOSTILE_ESCALATION: ReadonlySet<string> = new Set(['provoke', 'insult']);

export function valenceOf(action: string, outcome: string): number {
  if (outcome === 'escalated' && HOSTILE_ESCALATION.has(action)) return 0.4;
  return VALENCE[outcome] ?? 0;
}

/** Issues où l'action « a eu lieu » et vaut d'être racontée (un refus poli ou une esquive ne laisse pas de fait). */
const FACT_OUTCOMES: ReadonlySet<string> = new Set([
  'accepted',
  'accepted_conditional',
  'escalated',
  'backfired',
  'detected',
  'believed',
  'doubted',
  'won',
  'lost',
  'draw',
]);

export const leavesFact = (outcome: string): boolean => FACT_OUTCOMES.has(outcome);

/** Un succès : valence ≥ 0,5 (accepté, accepté sous condition, cru, gagné, non détecté, trouvé). */
export const isSuccess = (action: string, outcome: string): boolean => valenceOf(action, outcome) >= 0.5;

/** Espérance de valence d'une distribution d'issues. */
export function expectedValence(action: string, distribution: Readonly<Record<string, number>>): number {
  return Object.entries(distribution).reduce((s, [o, p]) => s + p * valenceOf(action, o), 0);
}

/** Probabilité de succès d'une distribution d'issues. */
export function successProbability(action: string, distribution: Readonly<Record<string, number>>): number {
  return Object.entries(distribution).reduce((s, [o, p]) => s + (isSuccess(action, o) ? p : 0), 0);
}

/** Les actions sans issue incertaine (une seule issue) réussissent toujours. */
export const hasUncertainOutcome = (action: string): boolean => (actionDef(action)?.outcomes.length ?? 0) > 1;
