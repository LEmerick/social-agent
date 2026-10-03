/**
 * Rejeu d'une saison depuis son seul journal (engine-architecture.md §6 et §12, plan §5.2).
 *
 * Pour chaque époque terminée : on repart des projections figées de l'époque précédente (lignes `character_state`,
 * relations de clôture), on rejoue les effets dans l'ordre du journal en vérifiant chaque `valueAfter`, les
 * transitions de statut, les entrées de score, puis on compare le résultat aux projections stockées de l'époque.
 * Chaque époque est ainsi vérifiée isolément : une corruption ne se propage pas en cascade d'une époque à l'autre.
 *
 * Limites assumées : les connaissances sont en ajout seul (pas d'event par arête) et sont donc vérifiées par
 * cohérence référentielle (events d'origine, parents, faits), pas reconstruites ; la toute première époque du monde
 * ne connaît pas les relations d'amorçage (écrasées par les projections) : la première valeur de chaque axe touché
 * y sert d'ancre.
 */
import { stateHash, journalHash } from '../events/hash.js';
import { replayStatuses } from '../events/replay.js';
import { DomainError } from '../core/errors.js';
import type { StoragePort } from '../ports/storage.js';
import { applyEffect, edge } from '../state/apply-effect.js';
import type { CharacterStateRecord, EffectRecord, EventRecord } from '../state/journal.js';
import { DEFAULT_STATS, loadSimState } from '../state/load.js';
import {
  AXIS_BOUNDS,
  AXIS_DEFAULTS,
  BASE_AXES,
  SCORE_NAMES,
  STAT_KEYS,
  relKey,
  type Axis,
  type Id,
  type RelationshipEdge,
  type ScoreName,
  type SimState,
} from '../state/types.js';
import type { Finding, ReplayDiff } from './findings.js';
import { type EpochData, type SeasonData, loadSeasonData } from './season-data.js';

export interface ReplayResult {
  readonly ok: boolean;
  /** Hachage de l'état final reconstruit depuis le journal (identique d'un adaptateur à l'autre). */
  readonly stateHash: string;
  /** Hachage de l'ensemble des events du monde, dans l'ordre. */
  readonly journalHash: string;
  readonly epochs: number;
  readonly diffs: ReplayDiff[];
  /** État final reconstruit (celui dont `stateHash` est le hachage). */
  readonly state: SimState;
}

/** Tolérance sur les valeurs recalculées : les additions sont identiques, seule la sérialisation peut les arrondir. */
const EPS = 1e-6;
const same = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

export async function replaySeason(storage: StoragePort, worldId: Id, seasonNumber: number): Promise<ReplayResult> {
  const data = await loadSeasonData(storage, worldId, seasonNumber);
  const base = await loadSimState(storage, worldId, seasonNumber);
  return replayData(data, base);
}

/** Cœur pur du rejeu (aucun accès au stockage) : réutilisé par l'audit. */
export function replayData(data: SeasonData, base: Readonly<SimState>): ReplayResult {
  const diffs: Finding[] = [];
  const slug = (id: Id): string => base.characters[id]?.slug ?? id.slice(0, 8);
  const label = (path: string): string => prettyPath(path, slug);

  let working = structuredClone(base) as SimState;
  const weighted = new Map<Id, Record<ScoreName, number>>();
  const offsets = scoreOffsets(data);
  let replayed = 0;

  for (const [index, ed] of data.epochs.entries()) {
    const number = ed.epoch.number;
    if (ed.epoch.status !== 'completed') {
      diffs.push({
        kind: 'epoch_unfinished',
        epoch: number,
        message: `Époque ${String(number)} non terminée (${ed.epoch.status}, dernier tick validé ${String(ed.epoch.lastCommittedTick)}) : rejeu arrêté.`,
      });
      break;
    }
    const start = index === 0 ? data.previous : previousOf(data.epochs[index - 1]);
    working = startOf(data, base, start, ed, index === 0 && data.previous === null);
    const chain = new Map<string, number>();
    const anchoring = index === 0 && data.previous === null;

    const anchored = new Set<string>();
    for (const fx of ed.journal.effects) {
      try {
        if (anchoring && fx.targetKind === 'relationship' && fx.otherCharacterId) {
          const key = `${fx.characterId}|${fx.otherCharacterId}|${fx.dimension}`;
          if (!anchored.has(key)) {
            anchored.add(key);
            setValue(working, fx, fx.valueAfter === null ? 0 : fx.valueAfter - fx.delta);
          }
        }
        const value = applyEffect(working, fx);
        if (fx.targetKind === 'score') {
          const key = `${fx.characterId}|${fx.dimension}`;
          const previous = chain.get(key);
          const expected = previous === undefined ? null : round6(previous + fx.delta);
          chain.set(key, fx.valueAfter ?? 0);
          if (expected !== null && fx.valueAfter !== null && !same(expected, fx.valueAfter)) {
            diffs.push(effectDiff(fx, number, label, expected));
          }
          continue;
        }
        if (value !== null && fx.valueAfter !== null && !same(value, fx.valueAfter)) {
          if (anchoring && fx.targetKind === 'relationship' && isClampedAnchor(fx)) {
            setValue(working, fx, fx.valueAfter);
            continue;
          }
          diffs.push(effectDiff(fx, number, label, value));
          setValue(working, fx, fx.valueAfter);
        }
      } catch (error) {
        diffs.push({
          kind: 'effect_value',
          epoch: number,
          message: `Époque ${String(number)} : effet ${fx.id} (${fx.ruleId}) non rejouable : ${messageOf(error)}`,
        });
      }
    }
    try {
      replayStatuses(working, ed.journal.events);
    } catch (error) {
      diffs.push({ kind: 'status', epoch: number, message: `Époque ${String(number)} : ${messageOf(error)}` });
    }
    for (const entry of ed.journal.scoreEntries) {
      const acc = weighted.get(entry.characterId) ?? zeroScores();
      acc[entry.score] += entry.weight * entry.impact;
      weighted.set(entry.characterId, acc);
    }
    for (const [id, c] of Object.entries(working.characters)) {
      const acc = weighted.get(id);
      for (const name of SCORE_NAMES) c.scores[name] = round6((offsets.get(id)?.[name] ?? 0) + (acc?.[name] ?? 0));
    }

    diffs.push(...compareEpoch(working, ed, start, chain, label, slug));
    replayed += 1;
  }

  diffs.push(...checkKnowledge(data, slug));

  const final = roundNumbers(assemble(data, base, working, replayed));
  if (data.current && replayed === data.epochs.length && replayed > 0) {
    diffs.push(...compareLive(final, base, data.epochs[replayed - 1]?.epoch.number ?? null, label));
  }
  return {
    ok: diffs.length === 0,
    stateHash: stateHash(final),
    journalHash: journalHash(roundNumbers(data.events.map(withSortedParticipants))),
    epochs: replayed,
    diffs,
    state: final,
  };
}

// ───── Points de départ ─────

interface Start {
  readonly states: readonly CharacterStateRecord[];
  readonly snapshot: readonly RelationshipEdge[];
}

const previousOf = (ed: EpochData | undefined): Start | null =>
  ed ? { states: ed.states, snapshot: ed.snapshot } : null;

/** `SimState` de travail au début d'une époque : lignes d'état et relations figées de l'époque précédente. */
function startOf(
  data: SeasonData,
  base: Readonly<SimState>,
  from: Start | null,
  current: EpochData | undefined,
  firstEver: boolean,
): SimState {
  const state = structuredClone(base) as SimState;
  const rows = new Map((from?.states ?? []).map((r) => [r.characterId, r]));
  const records = new Map(data.characters.map((c) => [c.id, c]));
  for (const [id, c] of Object.entries(state.characters)) {
    const row = rows.get(id);
    const stats = { ...DEFAULT_STATS };
    for (const key of STAT_KEYS) stats[key] = row?.stats[key] ?? stats[key];
    c.stats = stats;
    c.mood = { ...row?.mood };
    c.credits = row?.credits ?? state.season.rules.economy.startingCredits;
    c.status = row?.status ?? records.get(id)?.status ?? c.status;
    c.restrictedSinceEpoch = null;
    c.scores = Object.fromEntries(SCORE_NAMES.map((n) => [n, row?.scores[n] ?? 0])) as Record<ScoreName, number>;
  }
  // Première époque du monde : les relations d'amorçage sont perdues, la clôture de l'époque sert de base.
  const edges = from?.snapshot ?? (firstEver && current ? current.snapshot : []);
  state.relationships = Object.fromEntries(edges.map((e) => [relKey(e.sourceId, e.targetId), structuredClone(e)]));
  return state;
}

/** Score de chaque personnage avant la première époque rejouée. */
function scoreOffsets(data: SeasonData): Map<Id, Record<ScoreName, number>> {
  const out = new Map<Id, Record<ScoreName, number>>();
  for (const row of data.previous?.states ?? []) {
    out.set(
      row.characterId,
      Object.fromEntries(SCORE_NAMES.map((n) => [n, row.scores[n] ?? 0])) as Record<ScoreName, number>,
    );
  }
  return out;
}

const zeroScores = (): Record<ScoreName, number> =>
  Object.fromEntries(SCORE_NAMES.map((n) => [n, 0])) as Record<ScoreName, number>;

// ───── Effets ─────

/** Pose directement la valeur d'une dimension (resynchronisation après un écart, ancre de première époque). */
function setValue(state: SimState, fx: EffectRecord | Omit<EffectRecord, 'valueAfter'>, value: number): void {
  const c = state.characters[fx.characterId];
  if (!c) return;
  switch (fx.targetKind) {
    case 'relationship': {
      if (!fx.otherCharacterId) return;
      const e = edge(state, fx.characterId, fx.otherCharacterId);
      if ((BASE_AXES as readonly string[]).includes(fx.dimension)) e[fx.dimension as Axis] = value;
      else e.extraAxes[fx.dimension] = value;
      return;
    }
    case 'stat':
      if ((STAT_KEYS as readonly string[]).includes(fx.dimension)) {
        (c.stats as Record<string, number>)[fx.dimension] = value;
      }
      return;
    case 'mood':
      c.mood[fx.dimension] = value;
      return;
    case 'score':
      if ((SCORE_NAMES as readonly string[]).includes(fx.dimension)) c.scores[fx.dimension as ScoreName] = value;
      return;
    case 'credit':
      c.credits = value;
      return;
    default:
      return;
  }
}

/** Première valeur d'un axe de la première époque, écrêtée : l'ancre `valueAfter − delta` n'est pas déduisible. */
function isClampedAnchor(fx: EffectRecord): boolean {
  if (fx.valueAfter === null) return false;
  const axis = fx.dimension as Axis;
  const bounds = (BASE_AXES as readonly string[]).includes(fx.dimension) ? AXIS_BOUNDS[axis] : ([0, 100] as const);
  return fx.valueAfter <= bounds[0] || fx.valueAfter >= bounds[1];
}

function effectDiff(fx: EffectRecord, epoch: number, label: (path: string) => string, replayed: number): ReplayDiff {
  const path = effectPathOf(fx);
  return {
    kind: 'effect_value',
    epoch,
    path,
    replayed,
    stored: fx.valueAfter,
    message: `Époque ${String(epoch)}, tick ${String(fx.tick)} : effet ${fx.ruleId} sur ${label(path)} : valeur rejouée ${String(replayed)} ≠ journalisée ${String(fx.valueAfter)}.`,
  };
}

function effectPathOf(fx: EffectRecord): string {
  switch (fx.targetKind) {
    case 'relationship':
      return `rel.${relKey(fx.characterId, fx.otherCharacterId ?? '')}.${fx.dimension}`;
    case 'stat':
      return `char.${fx.characterId}.stats.${fx.dimension}`;
    case 'mood':
      return `char.${fx.characterId}.mood.${fx.dimension}`;
    case 'score':
      return `char.${fx.characterId}.scores.${fx.dimension}`;
    default:
      return `char.${fx.characterId}.credits`;
  }
}

// ───── Comparaison avec les projections ─────

function compareEpoch(
  working: SimState,
  ed: EpochData,
  start: Start | null,
  chain: ReadonlyMap<string, number>,
  label: (path: string) => string,
  slug: (id: Id) => string,
): Finding[] {
  const out: Finding[] = [];
  const epoch = ed.epoch.number;
  const rows = new Map(ed.states.map((r) => [r.characterId, r]));
  const startRows = new Map((start?.states ?? []).map((r) => [r.characterId, r]));
  for (const id of Object.keys(working.characters).sort()) {
    const c = working.characters[id];
    const row = rows.get(id);
    if (!c) continue;
    if (!row) {
      out.push({
        kind: 'state_missing',
        epoch,
        path: `char.${id}`,
        message: `Époque ${String(epoch)} : aucune ligne character_state pour ${slug(id)}.`,
      });
      continue;
    }
    const values: [string, number, number][] = [];
    for (const key of STAT_KEYS) values.push([`char.${id}.stats.${key}`, c.stats[key], row.stats[key] ?? NaN]);
    for (const key of new Set([...Object.keys(c.mood), ...Object.keys(row.mood)])) {
      values.push([`char.${id}.mood.${key}`, c.mood[key] ?? 0, row.mood[key] ?? 0]);
    }
    values.push([`char.${id}.credits`, c.credits, row.credits]);
    for (const [path, replayed, stored] of values) {
      if (!same(replayed, stored)) out.push(projectionDiff(epoch, path, replayed, stored, label));
    }
    if (c.status !== row.status) {
      out.push({
        kind: 'status',
        epoch,
        path: `char.${id}.status`,
        replayed: c.status,
        stored: row.status,
        message: `Époque ${String(epoch)} : statut de ${slug(id)} rejoué « ${c.status} » ≠ stocké « ${row.status} ».`,
      });
    }
    for (const name of SCORE_NAMES) {
      const stored = row.scores[name] ?? 0;
      const candidates = [c.scores[name], chain.get(`${id}|${name}`), startRows.get(id)?.scores[name] ?? 0];
      if (!candidates.some((v) => v !== undefined && same(v, stored))) {
        out.push({
          kind: 'score',
          epoch,
          path: `char.${id}.scores.${name}`,
          replayed: c.scores[name],
          stored,
          message: `Époque ${String(epoch)} : score ${name} de ${slug(id)} rejoué ${String(c.scores[name])} ≠ stocké ${String(stored)}.`,
        });
      }
    }
  }
  out.push(...compareRelationships(working, ed, label));
  out.push(...compareLedger(ed, slug));
  return out;
}

function projectionDiff(
  epoch: number,
  path: string,
  replayed: number,
  stored: number,
  label: (path: string) => string,
): ReplayDiff {
  return {
    kind: 'projection',
    epoch,
    path,
    replayed,
    stored,
    message: `Époque ${String(epoch)} : ${label(path)} rejoué ${String(replayed)} ≠ stocké ${String(stored)}.`,
  };
}

/** Valeur d'une arête absente : équivaut à l'arête par défaut. */
function absent(path: string): number {
  if (path.includes('.extra.')) return 0;
  const last = path.split('.').at(-1) ?? '';
  return last in AXIS_DEFAULTS ? AXIS_DEFAULTS[last as Axis] : 0;
}

function relationValues(edges: Readonly<Record<string, RelationshipEdge>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, e] of Object.entries(edges)) {
    for (const axis of BASE_AXES) out.set(`rel.${key}.${axis}`, e[axis]);
    for (const [k, v] of Object.entries(e.extraAxes)) out.set(`rel.${key}.extra.${k}`, v);
  }
  return out;
}

function compareRelationships(working: SimState, ed: EpochData, label: (path: string) => string): Finding[] {
  const stored = relationValues(Object.fromEntries(ed.snapshot.map((e) => [relKey(e.sourceId, e.targetId), e])));
  const replayed = relationValues(working.relationships);
  const out: Finding[] = [];
  for (const path of [...new Set([...stored.keys(), ...replayed.keys()])].sort()) {
    const a = replayed.get(path) ?? absent(path);
    const b = stored.get(path) ?? absent(path);
    if (!same(a, b)) out.push(projectionDiff(ed.epoch.number, path, a, b, label));
  }
  return out;
}

/** Le grand livre doit refléter les effets de crédit de l'époque, personnage par personnage. */
function compareLedger(ed: EpochData, slug: (id: Id) => string): Finding[] {
  const ledger = new Map<Id, number>();
  for (const l of ed.journal.ledger) ledger.set(l.characterId, (ledger.get(l.characterId) ?? 0) + l.amount);
  const credits = new Map<Id, number>();
  for (const fx of ed.journal.effects) {
    if (fx.targetKind === 'credit') credits.set(fx.characterId, (credits.get(fx.characterId) ?? 0) + fx.delta);
  }
  const out: Finding[] = [];
  for (const id of [...new Set([...ledger.keys(), ...credits.keys()])].sort()) {
    const l = ledger.get(id) ?? 0;
    const c = credits.get(id) ?? 0;
    if (!same(l, c)) {
      out.push({
        kind: 'ledger',
        epoch: ed.epoch.number,
        path: `char.${id}.ledger`,
        replayed: c,
        stored: l,
        message: `Époque ${String(ed.epoch.number)} : grand livre de ${slug(id)} (${String(l)}) ≠ effets de crédit (${String(c)}).`,
      });
    }
  }
  return out;
}

// ───── Connaissances ─────

/** Cohérence référentielle des connaissances : events d'origine, parents et faits doivent exister. */
function checkKnowledge(data: SeasonData, slug: (id: Id) => string): Finding[] {
  const events = new Set(data.events.map((e) => e.id));
  const facts = new Set(data.facts.map((f) => f.id));
  const edges = new Set(data.knowledge.map((k) => k.id));
  const out: Finding[] = [];
  for (const f of data.facts) {
    if (f.originEventId !== null && !events.has(f.originEventId)) {
      out.push({
        kind: 'knowledge',
        epoch: null,
        path: `fact.${f.id}`,
        message: `Fait ${f.id} : event d'origine ${f.originEventId} absent du journal.`,
      });
    }
  }
  for (const k of data.knowledge) {
    const problem = !facts.has(k.factId)
      ? `fait ${k.factId} inconnu`
      : k.viaEventId !== null && !events.has(k.viaEventId)
        ? `event ${k.viaEventId} absent du journal`
        : k.parentKnowledgeId !== null && !edges.has(k.parentKnowledgeId)
          ? `connaissance parente ${k.parentKnowledgeId} absente`
          : null;
    if (problem) {
      out.push({
        kind: 'knowledge',
        epoch: k.learnedEpoch,
        path: `knowledge.${k.id}`,
        message: `Connaissance ${k.id} de ${slug(k.characterId)} : ${problem}.`,
      });
    }
  }
  return out;
}

/** Les relations vivantes (table `relationship`) doivent égaler la fin du rejeu quand la saison est la plus récente. */
function compareLive(
  final: Readonly<SimState>,
  base: Readonly<SimState>,
  epoch: number | null,
  label: (path: string) => string,
): Finding[] {
  const live = relationValues(base.relationships);
  const replayed = relationValues(final.relationships);
  const out: Finding[] = [];
  for (const path of [...new Set([...live.keys(), ...replayed.keys()])].sort()) {
    const a = replayed.get(path) ?? absent(path);
    const b = live.get(path) ?? absent(path);
    if (!same(a, b))
      out.push({
        ...projectionDiff(epoch ?? 0, path, a, b, label),
        message: `Relations vivantes : ${label(path)} rejoué ${String(a)} ≠ stocké ${String(b)}.`,
      });
  }
  return out;
}

// ───── Assemblage ─────

/** Le port ne fixe pas l'ordre des participants d'un event : on le normalise pour que le hachage soit portable. */
const withSortedParticipants = (event: EventRecord): EventRecord => ({
  ...event,
  participants: [...event.participants].sort(
    (a, b) => a.characterId.localeCompare(b.characterId) || a.role.localeCompare(b.role),
  ),
});

/**
 * Arrondi à 9 décimales de tous les nombres de l'état : Postgres relit les flottants avec 15 chiffres significatifs,
 * la mémoire avec 17 ; sans cela le hachage différerait au dernier bit d'un adaptateur à l'autre.
 */
function roundNumbers<T>(value: T): T {
  if (typeof value === 'number') return (Number.isFinite(value) ? Math.round(value * 1e9) / 1e9 : value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => roundNumbers(v)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundNumbers(v)])) as T;
  }
  return value;
}

/** État final reconstruit : références et connaissances stockées, valeurs dynamiques issues du rejeu. */
function assemble(data: SeasonData, base: Readonly<SimState>, working: SimState, replayed: number): SimState {
  const final = structuredClone(base) as SimState;
  const last = data.epochs[replayed - 1];
  // Champs non numériques : relations vivantes (toutes les colonnes), sinon cliché de clôture.
  const stored = new Map((last?.snapshot ?? []).map((e) => [relKey(e.sourceId, e.targetId), e]));
  final.characters = working.characters;
  final.relationships = Object.fromEntries(
    Object.entries(working.relationships).map(([key, e]) => [
      key,
      { ...(base.relationships[key] ?? stored.get(key) ?? e), ...numericAxes(e) },
    ]),
  );
  final.epoch = null;
  final.tick = 0;
  final.nextEventSeq = data.events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  return final;
}

function numericAxes(e: RelationshipEdge): Pick<RelationshipEdge, Axis | 'extraAxes'> {
  const { trust, affection, rivalry, respect, fear, attraction, alliance, extraAxes } = e;
  return { trust, affection, rivalry, respect, fear, attraction, alliance, extraAxes: { ...extraAxes } };
}

// ───── Présentation ─────

/** `rel.<a>><b>.trust` → `relation Alexandre→Sarah, trust` ; `char.<id>.credits` → `crédits de Alexandre`. */
function prettyPath(path: string, slug: (id: Id) => string): string {
  const rel = /^rel\.([^>]+)>([^.]+)\.(.+)$/.exec(path);
  if (rel) return `${slug(rel[1] ?? '')}→${slug(rel[2] ?? '')} (${rel[3] ?? ''})`;
  const ch = /^char\.([^.]+)\.(.+)$/.exec(path);
  if (ch) return `${ch[2] ?? ''} de ${slug(ch[1] ?? '')}`;
  return path;
}

const messageOf = (error: unknown): string =>
  error instanceof DomainError
    ? `${error.code} ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
