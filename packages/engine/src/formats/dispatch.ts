/**
 * Actions d'objet, de vote et d'espionnage dans les interactions : après la résolution relationnelle (event de
 * l'interaction, effets sociaux), l'issue de l'`OutcomeModel` est exécutée par les services de formats
 * (game-formats.md §2, §5). Les événements `item_*` ont pour cause l'event de l'interaction ; les témoins
 * viennent de l'audience (perception) et la possession devient une connaissance (`holds`).
 */
import { DomainError } from '../core/errors.js';
import type { ActionOption } from '../decision/ports.js';
import type { TickContext } from '../epoch/types.js';
import { createFact } from '../knowledge/facts.js';
import { witness } from '../knowledge/transmit.js';
import type { Listener } from '../scene/audience.js';
import { formatOf, membersOf, type ItemNode } from '../state/format-state.js';
import type { EventRecord } from '../state/journal.js';
import type { Id } from '../state/types.js';
import { findItem, giveItem, hideItem, pickUp, stealItem, tradeItems } from './inventory.js';
import { revealTargets } from './inventory-search.js';
import { fakeItem, showItem, useItem } from './inventory-use.js';
import { formatContextOf } from './hook-kit.js';
import { emptyOutput, mergeOutput, type FormatContext, type FormatOutput } from './output.js';
import { recordAction } from './tracking.js';
import { castVote, candidatesOf, playItem } from './votes.js';

/** Actions confiées aux services de formats par l'interaction. */
export const FORMAT_ACTIONS: ReadonlySet<string> = new Set([
  'search',
  'pick_up',
  'give',
  'trade',
  'steal',
  'hide',
  'show_item',
  'use_item',
  'fake_item',
  'cast_vote',
  'spy_camp',
]);

export interface DispatchArgs {
  readonly actorId: Id;
  readonly option: ActionOption;
  readonly outcome: string;
  /** Event de l'interaction : cause des événements d'objet. */
  readonly event: EventRecord;
  /** Qui perçoit l'acteur ; pour une action cachée détectée, les témoins du lieu. */
  readonly witnesses: readonly Listener[];
  /** Décision de l'acteur (bulletin tracé). */
  readonly decisionId: Id | null;
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

/** Premier vote ouvert dont l'acteur est électeur. */
export function openSessionFor(ctx: Pick<TickContext, 'state'>, actorId: Id): string | undefined {
  return Object.values(formatOf(ctx.state).voteSessions)
    .filter((s) => s.result === null && s.kind !== 'public' && s.electorate.includes(actorId))
    .sort(byId)[0]?.id;
}

function hiddenAt(ctx: TickContext, locationId: Id): ItemNode[] {
  const fs = formatOf(ctx.state);
  return Object.values(fs.items)
    .filter((i) => i.locationId === locationId && i.hidden && i.holderId === null && i.state === 'active')
    .sort(byId);
}

function discover(ctx: TickContext, fc: FormatContext, out: FormatOutput, a: DispatchArgs, locationId: Id): void {
  const fs = formatOf(ctx.state);
  const isClue = (i: ItemNode): boolean => fs.itemDefs[i.itemDefId]?.kind === 'clue';
  const hidden = hiddenAt(ctx, locationId);
  const wantClue = a.outcome === 'found_clue';
  const pick = hidden.find((i) => isClue(i) === wantClue) ?? hidden[0];
  if (!pick) return;
  const taken = findItem(ctx.state, fc, {
    actorId: a.actorId,
    itemId: pick.id,
    witnesses: a.witnesses,
    causedByEventId: a.event.id,
  });
  mergeOutput(out, taken);
  if (isClue(pick)) revealTargets(ctx.state, fc, out, a.actorId, pick, taken.event.id);
}

/** Le plus petit objet actif et transférable que `holderId` peut céder en troc. */
function tradeable(ctx: TickContext, holderId: Id): ItemNode | undefined {
  const fs = formatOf(ctx.state);
  return Object.values(fs.items)
    .filter((i) => i.holderId === holderId && i.state === 'active' && fs.itemDefs[i.itemDefId]?.transferable !== false)
    .sort(byId)[0];
}

function spy(ctx: TickContext, fc: FormatContext, out: FormatOutput, a: DispatchArgs, campId: Id): void {
  const fs = formatOf(ctx.state);
  const camp = Object.values(fs.teams).find((t) => t.campLocationId === campId && t.dissolvedEpoch === null);
  const members = camp ? membersOf(fs, camp.id, ctx.epochNumber) : [];
  const here = members.filter((m) => {
    const p = ctx.state.positions[m];
    return p?.kind === 'at' && p.locationId === campId;
  });
  if (a.outcome === 'undetected') {
    // L'espion constate ce que portent les membres présents : la possession devient une connaissance.
    for (const holderId of here) {
      for (const item of Object.values(fs.items).filter((i) => i.holderId === holderId && i.state === 'active')) {
        const fact = Object.values(ctx.state.facts).find(
          (f) => f.isTrue && f.subjectId === holderId && f.objectText === `item:${item.id}` && f.predicate === 'holds',
        );
        if (!fact) continue;
        const learned = witness(
          ctx.state,
          {
            factIds: [fact.id],
            witnesses: [{ characterId: a.actorId, perception: 'hears' }],
            viaEventId: a.event.id,
            epoch: fc.epoch,
            tick: fc.tick,
          },
          fc.ids,
        );
        out.knowledge.push(...learned.knowledge);
      }
    }
  } else {
    // Repéré : les membres présents savent que l'espion est venu.
    const fact = createFact(
      ctx.state,
      {
        subjectId: a.actorId,
        predicate: 'spied_on',
        objectText: `location:${campId}`,
        sensitivity: 2,
        originEventId: a.event.id,
      },
      fc.ids,
    );
    out.facts.push(fact);
    const learned = witness(
      ctx.state,
      {
        factIds: [fact.id],
        witnesses: here.map((characterId) => ({ characterId, perception: 'hears' as const })),
        viaEventId: a.event.id,
        epoch: fc.epoch,
        tick: fc.tick,
      },
      fc.ids,
    );
    out.knowledge.push(...learned.knowledge);
  }
}

/**
 * Exécute l'action d'objet, de vote ou d'espionnage choisie. Ne fait rien pour une issue sans conséquence
 * (`not_found`, `refused`, `backfired`). Renvoie la sortie à verser dans le lot (`absorb`).
 */
export function dispatchFormatAction(ctx: TickContext, a: DispatchArgs): FormatOutput {
  const { state } = ctx;
  const { option, actorId, outcome } = a;
  const fc = formatContextOf(ctx);
  const out = emptyOutput();
  const cause = { causedByEventId: a.event.id };
  const itemId = option.itemId;
  const targetId = option.targetId;

  switch (option.action) {
    case 'search': {
      const locationId = option.locationId;
      if (locationId && (outcome === 'found' || outcome === 'found_clue')) discover(ctx, fc, out, a, locationId);
      break;
    }
    case 'pick_up':
      if (itemId) mergeOutput(out, pickUp(state, fc, { actorId, itemId, witnesses: a.witnesses, ...cause }));
      break;
    case 'give':
      if (itemId && targetId && outcome === 'accepted') {
        mergeOutput(
          out,
          giveItem(state, fc, { fromId: actorId, toId: targetId, itemId, witnesses: a.witnesses, ...cause }),
        );
      }
      break;
    case 'trade': {
      const back = targetId ? tradeable(ctx, targetId) : undefined;
      if (itemId && targetId && back && outcome === 'accepted') {
        mergeOutput(
          out,
          tradeItems(state, fc, {
            aId: actorId,
            bId: targetId,
            aItemId: itemId,
            bItemId: back.id,
            witnesses: a.witnesses,
            ...cause,
          }),
        );
      }
      break;
    }
    case 'steal':
      if (itemId && targetId) {
        mergeOutput(
          out,
          stealItem(state, fc, {
            fromId: targetId,
            toId: actorId,
            itemId,
            detected: outcome === 'detected',
            witnesses: a.witnesses,
            ...cause,
          }),
        );
      }
      break;
    case 'hide':
      if (itemId) {
        mergeOutput(
          out,
          hideItem(state, fc, {
            actorId,
            itemId,
            ...(option.locationId ? { locationId: option.locationId } : {}),
            ...cause,
          }),
        );
      }
      break;
    case 'show_item':
      if (itemId) {
        const viewers = [
          ...a.witnesses,
          ...(targetId ? [{ characterId: targetId, perception: 'hears' as const }] : []),
        ];
        mergeOutput(out, showItem(state, fc, { actorId, itemId, viewers, ...cause }));
      }
      break;
    case 'use_item': {
      if (!itemId || outcome !== 'accepted') break;
      const fs = formatOf(state);
      const item = fs.items[itemId];
      const def = item ? fs.itemDefs[item.itemDefId] : undefined;
      const sessionId = openSessionFor(ctx, actorId);
      if (def?.effects['on'] === 'vote_session') {
        // Un objet de conseil ne se joue qu'en conseil : ailleurs il reste dans l'inventaire.
        if (sessionId) mergeOutput(out, playItem(state, fc, sessionId, actorId, itemId));
      } else {
        mergeOutput(out, useItem(state, fc, { actorId, itemId, ...cause }));
      }
      break;
    }
    case 'fake_item': {
      if (outcome !== 'undetected') break;
      const fs = formatOf(state);
      const defs = Object.values(fs.itemDefs).sort(byId);
      const def =
        (itemId ? fs.itemDefs[fs.items[itemId]?.itemDefId ?? ''] : undefined) ??
        defs.find((d) => d.kind === 'power') ??
        defs[0];
      if (def) mergeOutput(out, fakeItem(state, fc, { itemDefId: def.id, actorId, ...cause }));
      break;
    }
    case 'cast_vote': {
      const sessionId = openSessionFor(ctx, actorId);
      if (!sessionId || !targetId) break;
      const session = formatOf(state).voteSessions[sessionId];
      if (!session || !candidatesOf(state, session).includes(targetId)) break;
      if (formatOf(state).votes.some((v) => v.voteSessionId === sessionId && v.voterId === actorId)) break;
      castVote(state, { sessionId, voterId: actorId, targetId, decisionId: a.decisionId });
      break;
    }
    case 'spy_camp':
      if (option.locationId) spy(ctx, fc, out, a, option.locationId);
      break;
    default:
      throw new DomainError('UNKNOWN_ACTION', `Action de format inconnue : ${option.action}`);
  }
  if (state.ext['format']) {
    recordAction(state, {
      actorId,
      action: option.action,
      targetId,
      locationId: option.locationId,
      epoch: ctx.epochNumber,
      tick: ctx.tick,
    });
  }
  return out;
}
