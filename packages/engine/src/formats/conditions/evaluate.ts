/** Évaluation pure des conditions du DSL sur un `SimState` (aucune mutation, aucun accès extérieur). */
import { DomainError } from '../../core/errors.js';
import { BASE_AXES, relKey, type Id, type RelationshipEdge, type SimState } from '../../state/types.js';
import { defBySlug, isMemberAt, pairKey, peekFormat, type FormatState } from '../../state/format-state.js';
import { defaultEdge } from '../../state/apply-effect.js';
import type { Cmp, Condition, Quantifier } from './schema.js';

/** Valeurs des références `$self`, `$team`, `$deadline`. L'époque courante vient de `state.epoch` sauf si fournie. */
export interface Bindings {
  readonly self?: Id;
  readonly team?: Id;
  readonly deadline?: number;
  readonly epoch?: number;
}

const inGame = (state: Readonly<SimState>): Id[] =>
  Object.values(state.characters)
    .filter((c) => c.status !== 'eliminated' && c.status !== 'paused')
    .map((c) => c.id)
    .sort();

/** Comparaison : sans clé, vaut `fallback`. */
export function compare(value: number, cmp: Cmp | undefined, fallback = true): boolean {
  if (!cmp || Object.values(cmp).every((v) => v === undefined)) return fallback;
  return (
    (cmp.gte === undefined || value >= cmp.gte) &&
    (cmp.lte === undefined || value <= cmp.lte) &&
    (cmp.gt === undefined || value > cmp.gt) &&
    (cmp.lt === undefined || value < cmp.lt) &&
    (cmp.eq === undefined || value === cmp.eq)
  );
}

function epochOf(state: Readonly<SimState>, b: Bindings): number {
  return b.epoch ?? state.epoch?.number ?? 0;
}

function teamOfSelf(state: Readonly<SimState>, fs: Readonly<FormatState>, b: Bindings): Id[] {
  const epoch = epochOf(state, b);
  let teamId = b.team;
  if (!teamId && b.self) {
    teamId = fs.memberships
      .filter((m) => m.characterId === b.self && isMemberAt(m, epoch))
      .sort((x, y) => y.fromEpoch - x.fromEpoch)[0]?.teamId;
  }
  if (!teamId) return b.self ? [b.self] : [];
  const tid = teamId;
  return fs.memberships
    .filter((m) => m.teamId === tid && isMemberAt(m, epoch))
    .map((m) => m.characterId)
    .sort();
}

/** Ensemble de personnages désigné par une référence. `?` = tous les personnages en jeu. */
export function resolveWho(state: Readonly<SimState>, ref: string, b: Bindings): Id[] {
  const fs = peekFormat(state);
  if (ref === '$self') {
    if (!b.self) throw new DomainError('UNBOUND', 'Référence $self sans titulaire');
    return [b.self];
  }
  if (ref === '$team') return teamOfSelf(state, fs, b);
  if (ref === '?') return inGame(state);
  return state.characters[ref] ? [ref] : [];
}

const quantify = (ids: readonly Id[], q: Quantifier | undefined, test: (id: Id) => boolean): boolean =>
  q === 'all' ? ids.length > 0 && ids.every(test) : ids.some(test);

function objectMatches(
  fs: Readonly<FormatState>,
  wanted: string,
  fact: { readonly objectId: Id | null; readonly objectText: string | null },
): boolean {
  if (wanted.startsWith('item_def:')) {
    const slug = wanted.slice('item_def:'.length);
    if (fact.objectText === wanted) return true;
    const def = defBySlug(fs, slug);
    if (!def || !fact.objectText?.startsWith('item:')) return false;
    const item = fs.items[fact.objectText.slice('item:'.length)];
    return item !== undefined && !item.isFake && item.itemDefId === def.id;
  }
  return fact.objectText === wanted || fact.objectId === wanted;
}

function evalKnows(
  state: Readonly<SimState>,
  fs: Readonly<FormatState>,
  k: NonNullable<Condition['knows']>,
  b: Bindings,
) {
  const subjects = k.fact.subject === undefined || k.fact.subject === '?' ? null : resolveWho(state, k.fact.subject, b);
  return quantify(resolveWho(state, k.who, b), k.quantifier, (who) =>
    Object.values(state.knowledge).some((edge) => {
      if (edge.characterId !== who || edge.belief === 'disbelieves') return false;
      if (edge.confidence < (k.minConfidence ?? 0)) return false;
      const fact = state.facts[edge.factId];
      if (fact?.predicate !== k.fact.predicate) return false;
      if (subjects && (fact.subjectId === null || !subjects.includes(fact.subjectId))) return false;
      return k.fact.object === undefined || objectMatches(fs, k.fact.object, fact);
    }),
  );
}

function axisValue(edge: RelationshipEdge, axis: string): number {
  return (BASE_AXES as readonly string[]).includes(axis)
    ? edge[axis as (typeof BASE_AXES)[number]]
    : (edge.extraAxes[axis] ?? 0);
}

function evalRelationship(state: Readonly<SimState>, r: NonNullable<Condition['relationship']>, b: Bindings): boolean {
  const froms = resolveWho(state, r.from, b);
  const tos = resolveWho(state, r.to, b);
  const read = (s: Id, t: Id): number => axisValue(state.relationships[relKey(s, t)] ?? defaultEdge(s, t), r.axis);
  const ok = (s: Id, t: Id): boolean =>
    s !== t && compare(read(s, t), r.cmp) && (!r.mutual || compare(read(t, s), r.cmp));
  return quantify(froms, r.quantifier, (s) => tos.some((t) => ok(s, t)));
}

function evalStat(state: Readonly<SimState>, s: NonNullable<Condition['stat']>, b: Bindings): boolean {
  return quantify(resolveWho(state, s.who, b), s.quantifier, (id) => {
    const c = state.characters[id];
    if (!c) return false;
    const value =
      s.stat === 'credits'
        ? c.credits
        : s.stat in c.stats
          ? c.stats[s.stat as keyof typeof c.stats]
          : s.stat in c.scores
            ? c.scores[s.stat as keyof typeof c.scores]
            : undefined;
    return value !== undefined && compare(value, s.cmp);
  });
}

function evalVote(
  fs: Readonly<FormatState>,
  state: Readonly<SimState>,
  v: NonNullable<Condition['vote_result']>,
  b: Bindings,
) {
  const sessions = Object.values(fs.voteSessions)
    .filter((s) => s.result !== null && (v.kind === undefined || s.kind === v.kind))
    .sort((x, y) => x.id.localeCompare(y.id));
  const session = v.session && v.session !== 'last' ? fs.voteSessions[v.session] : sessions[sessions.length - 1];
  const result = session?.result;
  if (!result) return false;
  if (v.tied !== undefined && result.tied.length > 1 !== v.tied) return false;
  if (v.eliminated !== undefined) {
    if (result.eliminated === null) return false;
    return resolveWho(state, v.eliminated, b).includes(result.eliminated);
  }
  return true;
}

/** Vrai si la condition est satisfaite. Plusieurs clés dans un même objet : toutes doivent l'être. */
export function evaluate(cond: Condition, state: Readonly<SimState>, bindings: Bindings = {}): boolean {
  const fs = peekFormat(state);
  const epoch = epochOf(state, bindings);
  const checks: boolean[] = [];

  if (cond.holds) {
    const h = cond.holds;
    const slug = h.item.replace(/^item_def:/, '');
    const def = defBySlug(fs, slug);
    const who = new Set(resolveWho(state, h.who, bindings));
    const n = Object.values(fs.items).filter(
      (i) =>
        def !== undefined &&
        i.itemDefId === def.id &&
        !i.isFake &&
        i.state === 'active' &&
        i.holderId !== null &&
        who.has(i.holderId),
    ).length;
    checks.push(compare(n, h.count, n >= 1));
  }
  if (cond.knows) checks.push(evalKnows(state, fs, cond.knows, bindings));
  if (cond.relationship) checks.push(evalRelationship(state, cond.relationship, bindings));
  if (cond.stat) checks.push(evalStat(state, cond.stat, bindings));
  if (cond.action_done) {
    const a = cond.action_done;
    const targets = a.target === undefined ? null : resolveWho(state, a.target, bindings);
    checks.push(
      quantify(resolveWho(state, a.who, bindings), a.quantifier, (who) => {
        const n = fs.actionLog.filter(
          (r) =>
            r.actorId === who &&
            r.action === a.action &&
            (targets === null || (r.targetId !== null && targets.includes(r.targetId))),
        ).length;
        return compare(n, a.count, n >= 1);
      }),
    );
  }
  if (cond.present_with) {
    const p = cond.present_with;
    const others = resolveWho(state, p.with, bindings);
    checks.push(
      resolveWho(state, p.who, bindings).some((w) =>
        others.some((o) => w !== o && (fs.presence[pairKey(w, o)] ?? 0) >= p.ticks),
      ),
    );
  }
  if (cond.vote_result) checks.push(evalVote(fs, state, cond.vote_result, bindings));
  if (cond.count_active) checks.push(compare(inGame(state).length, cond.count_active));
  if (cond.epoch_gte !== undefined) checks.push(epoch >= cond.epoch_gte);
  if (cond.before) {
    const limit = cond.before.epoch === '$deadline' ? bindings.deadline : cond.before.epoch;
    checks.push(limit === undefined ? true : epoch <= limit);
  }
  if (cond.not) checks.push(!evaluate(cond.not, state, bindings));
  if (cond.all) checks.push(cond.all.every((c) => evaluate(c, state, bindings)));
  if (cond.any) checks.push(cond.any.some((c) => evaluate(c, state, bindings)));
  if (cond.count) {
    const n = cond.count.of.filter((c) => evaluate(c, state, bindings)).length;
    checks.push(compare(n, cond.count.cmp));
  }
  return checks.every(Boolean);
}
