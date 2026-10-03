/** Outils communs des hooks de format : contexte de service, versement de la sortie dans le lot, persistance par tick. */
import type { MutableTickBatch, TickContext } from '../epoch/types.js';
import { FORMAT_EXT_KEY, peekFormat } from '../state/format-state.js';
import { goalRecordOf } from '../state/journal.js';
import { relKey, type Id, type SimState } from '../state/types.js';
import { FORMAT_BATCH_KEY, FORMAT_DELTA_INDEX, type FormatDelta, diffFormat, mergeFormatDeltas } from './persist.js';
import { appendOutput, type FormatContext, type FormatOutput } from './output.js';

/** Contexte des services pour le tick courant (flux d'identifiants `format`, partagé par tous les hooks du tick). */
export const formatContextOf = (ctx: TickContext): FormatContext => ({
  ids: ctx.ids('format'),
  epochId: ctx.epochId,
  epoch: ctx.epochNumber,
  tick: ctx.tick,
});

/**
 * Verse une sortie de service dans un lot : événements, effets, faits, connaissances, arêtes de relation touchées
 * (bulletins révélés…) et objectifs créés.
 */
export function absorbInto(
  batch: MutableTickBatch,
  state: SimState,
  out: FormatOutput,
  epochNumber: number = state.epoch?.number ?? 0,
): void {
  appendOutput(batch, out);
  const touched = new Set(
    out.effects
      .filter((e) => e.targetKind === 'relationship' && e.otherCharacterId !== null)
      .map((e) => relKey(e.characterId, e.otherCharacterId ?? '')),
  );
  for (const key of [...touched].sort()) {
    const edge = state.relationships[key];
    if (!edge) continue;
    const at = batch.relationships.findIndex((r) => relKey(r.sourceId, r.targetId) === key);
    if (at >= 0) batch.relationships[at] = structuredClone(edge);
    else batch.relationships.push(structuredClone(edge));
  }
  for (const { characterId, goal } of out.goals) {
    batch.goals.push(goalRecordOf(characterId, goal, epochNumber, true));
  }
}

/** Verse une sortie de service dans le lot du tick courant. */
export function absorb(ctx: TickContext, out: FormatOutput): void {
  absorbInto(ctx.batch, ctx.state, out, ctx.epochNumber);
}

/** Personnages encore en jeu, triés. */
export const inGameIds = (state: Readonly<SimState>): Id[] =>
  Object.values(state.characters)
    .filter((c) => c.status !== 'eliminated' && c.status !== 'paused')
    .map((c) => c.id)
    .sort();

/** Le format est actif sur cet état (un `FormatState` est rangé dans `ext`). */
export const hasFormat = (state: Readonly<SimState>): boolean => state.ext[FORMAT_EXT_KEY] !== undefined;

/**
 * Dépose le `FormatState` courant dans le lot du tick (`ext['format']`, voir `withFormatCommit`) avec le delta des entités
 * modifiées depuis le dernier dépôt de l'exécution. À appeler en fin de tick, après tous les hooks de format.
 */
export function stageFormat(ctx: TickContext): void {
  if (!hasFormat(ctx.state)) return;
  const fs = peekFormat(ctx.state);
  const delta = diffFormat(ctx.state, fs);
  if (!delta) return;
  const previous = ctx.batch.ext[FORMAT_BATCH_KEY]?.[FORMAT_DELTA_INDEX] as FormatDelta | undefined;
  ctx.batch.ext = { ...ctx.batch.ext, [FORMAT_BATCH_KEY]: [fs, previous ? mergeFormatDeltas(previous, delta) : delta] };
}

const BUSY_KEY = 'format_busy';

/** Personnages pris par une scène imposée (épreuve, conseil…) à ce tick : les interactions libres les laissent tranquilles. */
export function markBusy(state: SimState, tick: number, ids: readonly Id[]): void {
  const current = busyOf(state, tick);
  state.ext[BUSY_KEY] = { tick, ids: [...new Set([...current, ...ids])].sort() };
}

export function busyOf(state: Readonly<SimState>, tick: number): Id[] {
  const busy = state.ext[BUSY_KEY] as { tick: number; ids: Id[] } | undefined;
  return busy && busy.tick === tick ? busy.ids : [];
}
