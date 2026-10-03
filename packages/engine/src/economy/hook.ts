/**
 * Hook `economy` du scheduler (phase 5) : entretien, ledger et transitions de survie via `settleEpoch`.
 * L'élimination reste une décision de règle de saison : `eliminate` est vide par défaut.
 * Le scheduler publie `character.status` après le commit du lot de clôture (events `status_changed`).
 */
import type { TickContext, TickHook } from '../epoch/types.js';
import type { Id } from '../state/types.js';
import { settleEpoch } from './settle.js';

export interface EconomyHookOptions {
  /** Personnages à éliminer à ce règlement (doivent être en `elimination_pending`). */
  readonly eliminate?: readonly Id[] | ((ctx: TickContext) => readonly Id[]);
}

export function economyHook(options: EconomyHookOptions = {}): TickHook {
  return (ctx) => {
    const eliminate = typeof options.eliminate === 'function' ? options.eliminate(ctx) : options.eliminate;
    const settled = settleEpoch(
      ctx.state,
      { id: ctx.epochId, number: ctx.epochNumber },
      ctx.ids('economy'),
      eliminate ? { eliminate } : {},
    );
    ctx.batch.events.push(...settled.events);
    ctx.batch.effects.push(...settled.effects);
    ctx.batch.ledger.push(...settled.ledger);
    ctx.batch.scoreEntries.push(...settled.scoreEntries);
  };
}
