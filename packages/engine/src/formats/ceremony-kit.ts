/** Briques communes des scènes imposées : effets journalisés, bulletins tracés par la `DecisionPolicy`, don d'objets. */
import { DomainError } from '../core/errors.js';
import { optionKey, type ActionOption } from '../decision/ports.js';
import type { TickContext } from '../epoch/types.js';
import { applyEffect } from '../state/apply-effect.js';
import { formatOf, type ItemDefNode } from '../state/format-state.js';
import type { EffectTarget, Id } from '../state/types.js';
import { formatContextOf } from './hook-kit.js';
import { locationOfCharacter } from './inventory-core.js';
import { pickUp, placeItem } from './inventory.js';
import { emitEffect, emitEvent, emptyOutput, mergeOutput, type FormatContext, type FormatOutput } from './output.js';

export const CEREMONY_RULE = 'ceremony';

/** Applique un effet numérique et le journalise sous l'événement donné. */
export function applyLogged(
  ctx: TickContext,
  fc: FormatContext,
  out: FormatOutput,
  eventId: Id,
  characterId: Id,
  targetKind: Extract<EffectTarget, 'stat' | 'credit' | 'score'>,
  dimension: string,
  delta: number,
): void {
  if (delta === 0) return;
  const valueAfter = applyEffect(ctx.state, {
    targetKind,
    characterId,
    otherCharacterId: null,
    dimension,
    delta,
    ruleId: CEREMONY_RULE,
    ruleVersion: 1,
    reason: null,
  });
  emitEffect(fc, out, eventId, { targetKind, characterId, dimension, delta, ruleId: CEREMONY_RULE, valueAfter });
}

/**
 * Pose la question à la `DecisionPolicy` du personnage et trace la décision (`TickBatch.decisions`).
 * Renvoie l'option choisie (`null` : abstention) et l'identifiant de la décision.
 */
export async function ask(
  ctx: TickContext,
  actorId: Id,
  options: readonly ActionOption[],
  stream: string,
): Promise<{ readonly chosen: ActionOption | null; readonly decisionId: Id | null }> {
  if (options.length === 0) return { chosen: null, decisionId: null };
  const decision = await ctx.decision.choose({
    actorId,
    state: ctx.state,
    options,
    rng: ctx.rng(stream, actorId),
  });
  const chosen = decision.chosen;
  if (chosen !== null && !options.some((o) => optionKey(o) === optionKey(chosen))) {
    throw new DomainError('INVALID_CHOICE', `${decision.policy} a choisi ${optionKey(chosen)}, hors des options`);
  }
  const decisionId = ctx.ids('ceremony-decision').next();
  ctx.batch.decisions.push({
    id: decisionId,
    epochId: ctx.epochId,
    tick: ctx.tick,
    characterId: actorId,
    kind: 'action',
    options: decision.distribution ?? options.map(optionKey),
    chosen,
    policy: decision.policy,
    rngDraw: decision.rngDraw,
    interactionId: null,
    llmCallId: decision.llmCallId ?? null,
  });
  return { chosen, decisionId };
}

export const optionOf = (action: string, over: Partial<ActionOption> = {}): ActionOption => ({
  action,
  targetId: null,
  factId: null,
  itemId: null,
  locationId: null,
  ...over,
});

/**
 * Remet un exemplaire neuf de `def` à `holderId` (récompense) : il est posé sur son lieu (`item_placed`) puis ramassé
 * (`item_picked_up`), de sorte que l'inventaire se rejoue depuis les events.
 */
export function grantItem(ctx: TickContext, def: ItemDefNode, holderId: Id, causedByEventId: Id): FormatOutput {
  const out = emptyOutput();
  const locationId = locationOfCharacter(ctx.state, holderId);
  if (!locationId) return out;
  const fc = formatContextOf(ctx);
  const placed = placeItem(ctx.state, fc, { itemDefId: def.id, locationId, hidden: false, causedByEventId });
  mergeOutput(out, placed);
  mergeOutput(out, pickUp(ctx.state, fc, { actorId: holderId, itemId: placed.item.id, causedByEventId }));
  return out;
}

/** Nombre d'exemplaires d'une définition déjà en circulation (tous états confondus). */
export const countOfDef = (ctx: TickContext, defId: Id): number =>
  Object.values(formatOf(ctx.state).items).filter((i) => i.itemDefId === defId && !i.isFake).length;

export { emitEvent };
