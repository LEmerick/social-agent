/**
 * Options disponibles pour un personnage : catalogue × cibles atteignables, filtrées par préconditions, coûts et statut.
 * Pur : le scheduler construit le `SceneContext` et appelle `availableOptions` à chaque décision.
 */
import { DomainError } from '../core/errors.js';
import type { ActionOption } from '../decision/ports.js';
import type { Id, SimState } from '../state/types.js';
import { ACTION_CATALOG, actionDef, assertInCatalog, isEnabled, isPaidAction } from './catalog.js';
import { memberOf } from './preconditions.js';
import type { ActionDef, SceneContext } from './types.js';

/** Coûts réellement dus : sans économie, les crédits ne coûtent rien. */
export const effectiveCost = (state: Readonly<SimState>, def: ActionDef): { energy: number; credits: number } => ({
  energy: def.cost.energy ?? 0,
  credits: state.season.rules.economy.enabled ? (def.cost.credits ?? 0) : 0,
});

const option = (action: string, over: Partial<ActionOption> = {}): ActionOption => ({
  action,
  targetId: null,
  factId: null,
  itemId: null,
  locationId: null,
  ...over,
});

/**
 * Refus lié au statut, à la restriction économique et aux coûts (tout sauf les préconditions de scène).
 * Raisons : `unknown_actor`, `status`, `not_in_catalog`, `disabled`, `restricted`, `credits`, `energy`.
 */
export function costRefusal(state: Readonly<SimState>, actorId: Id, opt: ActionOption): string | null {
  const actor = state.characters[actorId];
  if (!actor) return 'unknown_actor';
  if (actor.status !== 'active' && actor.status !== 'restricted') return 'status';
  const def = actionDef(opt.action);
  if (!def) return 'not_in_catalog';
  if (!isEnabled(state, def)) return 'disabled';
  const cost = effectiveCost(state, def);
  const paid = state.season.rules.economy.enabled && isPaidAction(def);
  if (actor.status === 'restricted' && paid) return 'restricted';
  if (cost.credits > 0 && actor.credits < cost.credits) return 'credits';
  if (cost.energy > 0 && actor.stats.energy < cost.energy) return 'energy';
  return null;
}

/** Raison pour laquelle l'action est refusée (voir `costRefusal`, plus `preconditions`), ou `null` si permise. */
export function refusalReason(
  state: Readonly<SimState>,
  actorId: Id,
  opt: ActionOption,
  ctx: SceneContext,
): string | null {
  const refusal = costRefusal(state, actorId, opt);
  if (refusal !== null) return refusal;
  const def = actionDef(opt.action);
  return def?.preconditions(state, actorId, opt, ctx) === true ? null : 'preconditions';
}

/** Lève une `DomainError` si l'action est refusée (catalogue, statut, restriction, coûts, préconditions). */
export function assertAllowed(state: Readonly<SimState>, actorId: Id, opt: ActionOption, ctx: SceneContext): void {
  assertInCatalog(state, opt.action);
  const reason = refusalReason(state, actorId, opt, ctx);
  if (reason !== null) throw new DomainError('ACTION_REFUSED', `Action ${opt.action} refusée (${reason})`);
}

const knownFactIds = (state: Readonly<SimState>, actorId: Id): Id[] =>
  [
    ...new Set(
      Object.values(state.knowledge)
        .filter((k) => k.characterId === actorId && k.belief !== 'disbelieves')
        .map((k) => k.factId),
    ),
  ].sort();

function candidates(def: ActionDef, state: Readonly<SimState>, actorId: Id, ctx: SceneContext): ActionOption[] {
  const me = memberOf(ctx, actorId);
  const others = ctx.members.filter((m) => m.characterId !== actorId).map((m) => m.characterId);
  const owned = ctx.inventory?.[actorId] ?? [];
  const id = def.id;
  switch (id) {
    case 'share_secret':
      return others.flatMap((t) => knownFactIds(state, actorId).map((f) => option(id, { targetId: t, factId: f })));
    case 'confront':
    case 'accuse':
      // Seule ou à propos d'un fait connu qui concerne la cible (sujet ou objet), mais pas de ce que l'acteur a fait lui-même.
      return others.flatMap((t) => [
        option(id, { targetId: t }),
        ...knownFactIds(state, actorId)
          .filter(
            (f) =>
              (state.facts[f]?.subjectId === t || state.facts[f]?.objectId === t) &&
              state.facts[f].subjectId !== actorId,
          )
          .map((f) => option(id, { targetId: t, factId: f })),
      ]);
    case 'give':
    case 'trade':
    case 'show_item':
      return others.flatMap((t) => owned.map((i) => option(id, { targetId: t, itemId: i })));
    case 'steal':
      return others.flatMap((t) => (ctx.inventory?.[t] ?? []).map((i) => option(id, { targetId: t, itemId: i })));
    case 'cast_vote':
      return (ctx.voteCandidates ?? others).map((t) => option(id, { targetId: t }));
    case 'move_to': {
      const pos = state.positions[actorId];
      if (pos?.kind !== 'at') return [];
      return state.routes
        .filter((r) => r.fromLocationId === pos.locationId)
        .map((r) => option(id, { locationId: r.toLocationId }));
    }
    case 'search':
      return me ? [option(id, { locationId: me.locationId })] : [];
    case 'hide':
      return me ? owned.map((i) => option(id, { locationId: me.locationId, itemId: i })) : [];
    case 'spy_camp':
      return (ctx.enemyCamps ?? []).map((l) => option(id, { locationId: l }));
    case 'join_activity':
      return (ctx.openSlots ?? []).map((s) => option(id, { targetId: s }));
    case 'pick_up':
      return (ctx.itemsHere ?? []).map((i) => option(id, { itemId: i }));
    case 'use_item':
      return owned.map((i) => option(id, { itemId: i }));
    default:
      return def.target === 'character' || def.target === 'characters'
        ? others.map((t) => option(id, { targetId: t }))
        : [option(id)];
  }
}

/**
 * Toutes les options permises à `actorId` dans la scène décrite par `ctx`, dans un ordre stable
 * (ordre du catalogue, puis ordre des membres de la scène). Vide si le statut ne permet pas d'agir.
 */
export function availableOptions(state: Readonly<SimState>, actorId: Id, ctx: SceneContext): ActionOption[] {
  const actor = state.characters[actorId];
  if (!actor || (actor.status !== 'active' && actor.status !== 'restricted')) return [];
  return Object.values(ACTION_CATALOG)
    .filter((def) => isEnabled(state, def))
    .flatMap((def) => candidates(def, state, actorId, ctx))
    .filter((o) => refusalReason(state, actorId, o, ctx) === null);
}
