/** Débit des actions payantes (crédits). Les coûts en énergie sont prélevés par la résolution (règle `cost@1`). */
import { DomainError } from '../core/errors.js';
import type { IdFactory } from '../core/id.js';
import type { ActionOption } from '../decision/ports.js';
import { applyAndRecord, type EventLink } from '../events/apply-record.js';
import { assertInCatalog } from '../rules/catalog.js';
import { costRefusal, effectiveCost } from '../rules/options.js';
import type { EffectInput, EffectRecord, LedgerRecord } from '../state/journal.js';
import type { Id, SimState } from '../state/types.js';

export const COST_RULE = { id: 'cost', version: 1 } as const;

/** Effet de coût `cost@1` sur une stat ou des crédits. */
export const costEffect = (
  characterId: Id,
  targetKind: 'stat' | 'credit',
  dimension: string,
  delta: number,
  action: string,
): EffectInput => ({
  targetKind,
  characterId,
  otherCharacterId: null,
  dimension,
  delta,
  ruleId: COST_RULE.id,
  ruleVersion: COST_RULE.version,
  reason: action,
});

/**
 * Débite les crédits de l'action (appliqué à l'état, journalisé dans le ledger). Sans coût en crédits : ne fait rien.
 * `creditCost` remplace le prix du catalogue (par exemple le prix d'un créneau, 1 à 5 crédits).
 * Refuse l'action en `restricted`, hors catalogue ou si le solde est insuffisant.
 */
export function chargeAction(
  state: SimState,
  actorId: Id,
  option: ActionOption,
  link: EventLink,
  ids: IdFactory,
  creditCost?: number,
): { effects: EffectRecord[]; ledger: LedgerRecord[] } {
  const def = assertInCatalog(state, option.action);
  const refusal = costRefusal(state, actorId, option);
  if (refusal !== null) throw new DomainError('ACTION_REFUSED', `Action ${option.action} refusée (${refusal})`);
  const amount = state.season.rules.economy.enabled ? (creditCost ?? effectiveCost(state, def).credits) : 0;
  if (amount <= 0) return { effects: [], ledger: [] };
  const actor = state.characters[actorId];
  if (!actor || actor.credits < amount) {
    throw new DomainError('ACTION_REFUSED', `Action ${option.action} refusée (credits)`);
  }
  const effect = applyAndRecord(state, costEffect(actorId, 'credit', 'credits', -amount, option.action), link, ids);
  const ledger: LedgerRecord = {
    id: ids.next(),
    characterId: actorId,
    epochId: link.epochId,
    eventId: link.eventId,
    amount: -amount,
    category: def.id === 'join_activity' ? 'activity' : 'special_action',
    source: 'system',
  };
  return { effects: [effect], ledger: [ledger] };
}

/** `C_fin = C_début − Σ débits + Σ crédits` : les montants du ledger sont signés (négatif = débit). */
export const closingBalance = (opening: number, ledger: readonly LedgerRecord[], characterId: Id): number =>
  ledger.filter((l) => l.characterId === characterId).reduce((c, l) => c + l.amount, opening);
