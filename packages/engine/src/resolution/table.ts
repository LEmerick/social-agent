/**
 * Table de règles versionnées, indexée sur `(action, issue)` (action-catalog.md §3).
 * Chaque entrée associe : une version, un type d'event, une importance et la fonction qui produit les effets.
 */
import { DomainError } from '../core/errors.js';
import { ACTION_CATALOG } from '../rules/catalog.js';
import type { ActionId, OutcomeId } from '../rules/types.js';
import { eventTypeFor, importanceFor } from './events-map.js';
import type { RuleFn, RuleSet } from './kit.js';
import { CONFLICT_RULES } from './rules-conflict.js';
import { MISC_RULES } from './rules-misc.js';
import { SOCIAL_RULES } from './rules-social.js';
import { STRATEGIC_RULES } from './rules-strategic.js';

export interface RuleDef {
  /** `action:issue`, stable : sert de `ruleId` aux effects. */
  readonly id: string;
  readonly version: number;
  readonly action: ActionId;
  readonly outcome: OutcomeId;
  readonly eventType: string;
  readonly importance: number;
  readonly effects: RuleFn;
}

/** Surcharges de version par règle (par défaut 1) : à incrémenter quand le calcul d'une règle change. */
const RULE_VERSIONS: Readonly<Record<string, number>> = {};

const SETS: Readonly<Record<ActionId, RuleSet>> = {
  ...SOCIAL_RULES,
  ...STRATEGIC_RULES,
  ...CONFLICT_RULES,
  ...MISC_RULES,
};

export const ruleId = (action: string, outcome: string): string => `${action}:${outcome}`;

export const RULE_TABLE: Readonly<Record<string, RuleDef>> = Object.fromEntries(
  Object.values(ACTION_CATALOG).flatMap((def) =>
    def.outcomes.map((outcome) => {
      const effects = SETS[def.id][outcome];
      if (!effects) throw new DomainError('MISSING_RULE', `Aucune règle pour ${ruleId(def.id, outcome)}`);
      const id = ruleId(def.id, outcome);
      const rule: RuleDef = {
        id,
        version: RULE_VERSIONS[id] ?? 1,
        action: def.id,
        outcome,
        eventType: eventTypeFor(def.id, outcome),
        importance: importanceFor(def.id, outcome),
        effects,
      };
      return [id, rule] as const;
    }),
  ),
);

/** Règle associée au couple `(action, issue)` ; erreur si l'issue n'est pas autorisée pour cette action. */
export function ruleFor(action: string, outcome: string): RuleDef {
  const rule = RULE_TABLE[ruleId(action, outcome)];
  if (!rule) throw new DomainError('UNKNOWN_OUTCOME', `Issue ${outcome} non autorisée pour l'action ${action}`);
  return rule;
}
