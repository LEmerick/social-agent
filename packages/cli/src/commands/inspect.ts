import {
  type CharacterNode,
  type EpochJournal,
  type KnowledgeEdge,
  type SimState,
  BASE_AXES,
  loadSimState,
  renderFactText,
} from '@ai-reality/engine';
import { type Context, openContext, preplay } from '../context.js';
import {
  ACQUAINTANCE_FR,
  AXIS_FR,
  BELIEF_FR,
  ROLE_FR,
  SCORE_FR,
  STAT_FR,
  STATUS_FR,
  namesOf,
  nameOf,
  num,
  pairs,
} from '../fr.js';
import { EXIT, type CliIo, CliError, emit } from '../io.js';
import type { Parsed } from '../options.js';
import { summarizeEpoch, summaryLines } from '../summary.js';

const SOURCE_FR: Readonly<Record<string, string>> = {
  seeded: 'connu dès le départ',
  public: 'information publique',
  witnessed: 'vu de ses yeux',
  overheard: 'entendu en passant',
  told: 'raconté',
  inferred: 'déduit',
};

/** `inspect character|scene|provenance|epoch …` */
export async function inspect(args: Parsed, io: CliIo): Promise<number> {
  const [kind, ...rest] = args.positionals;
  if (!kind)
    throw new CliError(
      'inspect exige une cible : character <slug>, scene <id>, provenance <perso> <fait> ou epoch <n>.',
    );
  const ctx = await openContext(args, io);
  try {
    await preplay(ctx, args);
    const state = await loadSimState(ctx.storage, ctx.worldId, ctx.seasonNumber);
    const [payload, lines] = await dispatch(kind, rest, args, ctx, state);
    emit(io, args.json, payload, lines);
    return EXIT.ok;
  } finally {
    await ctx.close();
  }
}

type Report = [payload: unknown, lines: string[]];

function dispatch(kind: string, rest: readonly string[], args: Parsed, ctx: Context, state: SimState): Promise<Report> {
  switch (kind) {
    case 'character':
      return character(rest, args, ctx, state);
    case 'scene':
      return scene(rest, ctx, state);
    case 'provenance':
      return provenance(rest, ctx, state);
    case 'epoch':
      return epoch(rest, args, ctx, state);
    default:
      throw new CliError(`Cible inconnue : « ${kind} » (character, scene, provenance, epoch).`);
  }
}

function need(values: readonly string[], index: number, what: string): string {
  const value = values[index];
  if (!value) throw new CliError(`Argument manquant : ${what}.`);
  return value;
}

/** Un personnage par slug ou par identifiant. */
function findCharacter(state: SimState, query: string): CharacterNode {
  const found = Object.values(state.characters).find((c) => c.slug === query || c.id === query);
  if (!found) {
    const known = Object.values(state.characters)
      .map((c) => c.slug)
      .sort()
      .join(', ');
    throw new CliError(`Personnage « ${query} » introuvable (connus : ${known}).`);
  }
  return found;
}

/** Un identifiant exact, ou un préfixe non ambigu. */
function byPrefix<T extends { readonly id: string }>(items: readonly T[], query: string, what: string): T {
  const exact = items.find((i) => i.id === query);
  if (exact) return exact;
  const matches = items.filter((i) => i.id.startsWith(query));
  const [first] = matches;
  if (matches.length === 1 && first) return first;
  throw new CliError(
    matches.length === 0
      ? `${what} « ${query} » introuvable.`
      : `${what} « ${query} » ambigu (${String(matches.length)} correspondances).`,
  );
}

// ───── character ─────

async function character(rest: readonly string[], args: Parsed, ctx: Context, state: SimState): Promise<Report> {
  const who = findCharacter(state, need(rest, 0, 'le slug du personnage'));
  const names = namesOf(state.characters);
  const at = args.epoch;

  const { node, relations, label } = await ctx.storage.tx(async (s) => {
    if (at === undefined) {
      const edges = Object.values(state.relationships).filter((e) => e.sourceId === who.id);
      return { node: who, relations: edges, label: 'état courant' };
    }
    const epoch = await s.epochs.findByNumber(ctx.worldId, at);
    if (!epoch) throw new CliError(`Époque ${String(at)} introuvable.`);
    const row = (await s.characterStates.listByEpoch(epoch.id)).find((r) => r.characterId === who.id);
    const edges = (await s.snapshots.relationships(epoch.id)).filter((e) => e.sourceId === who.id);
    const snapshot: CharacterNode = row
      ? {
          ...who,
          stats: { ...who.stats, ...row.stats },
          credits: row.credits,
          status: row.status,
          mood: { ...row.mood },
          scores: { ...who.scores, ...row.scores },
        }
      : who;
    return { node: snapshot, relations: edges, label: `fin de l’époque ${String(at)}` };
  });

  const known = Object.values(state.knowledge)
    .filter((k) => k.characterId === who.id && (at === undefined || k.learnedEpoch <= at))
    .sort((a, b) => a.learnedEpoch - b.learnedEpoch || a.learnedTick - b.learnedTick || (a.id < b.id ? -1 : 1));
  const facts = known.map((k) => {
    const fact = state.facts[k.factId];
    return {
      factId: k.factId,
      text: fact ? renderFactText(state, fact) : '(fait inconnu)',
      source: k.sourceType,
      toldBy: k.toldById === null ? null : nameOf(names, k.toldById),
      learnedEpoch: k.learnedEpoch,
      learnedTick: k.learnedTick,
      confidence: k.confidence,
      belief: k.belief,
    };
  });
  const rels = relations
    .sort((a, b) => (a.targetId < b.targetId ? -1 : 1))
    .map((e) => ({
      target: nameOf(names, e.targetId),
      targetSlug: state.characters[e.targetId]?.slug ?? e.targetId,
      acquaintance: e.acquaintance,
      axes: { ...Object.fromEntries(BASE_AXES.map((a) => [a, e[a]])), ...e.extraAxes },
      interactions: e.interactionCount,
    }));

  const payload = {
    character: { id: who.id, slug: who.slug, name: who.firstName, autonomy: who.autonomy, traits: who.traits },
    view: label,
    status: node.status,
    stats: node.stats,
    mood: node.mood,
    credits: node.credits,
    scores: node.scores,
    relations: rels,
    knowledge: facts,
  };
  const lines = [
    `${who.firstName} (${who.slug}) — ${STATUS_FR[node.status] ?? node.status} · ${label}`,
    `  Stats : ${pairs(node.stats, STAT_FR)}`,
    `  Humeur : ${Object.keys(node.mood).length > 0 ? pairs(node.mood, {}) : '—'}`,
    `  Crédits : ${num(node.credits)} · scores : ${pairs(node.scores, SCORE_FR)}`,
    `Relations sortantes (${String(rels.length)})`,
    ...rels.map(
      (r) => `  → ${r.target} [${ACQUAINTANCE_FR[r.acquaintance] ?? r.acquaintance}] : ${pairs(r.axes, AXIS_FR)}`,
    ),
    `Connaissances (${String(facts.length)})`,
    ...facts.map(
      (f) =>
        `  • ${f.text} — ${SOURCE_FR[f.source] ?? f.source}${f.toldBy ? ` par ${f.toldBy}` : ''} (époque ${String(f.learnedEpoch)}, tick ${String(f.learnedTick)}), ${BELIEF_FR[f.belief] ?? f.belief}, confiance ${num(f.confidence)} [fait ${f.factId}]`,
    ),
  ];
  return [payload, lines];
}

// ───── scene ─────

async function readAllEpochs(ctx: Context): Promise<{ number: number; journal: EpochJournal }[]> {
  return ctx.storage.tx(async (s) => {
    const out: { number: number; journal: EpochJournal }[] = [];
    for (let n = 0; ; n++) {
      const epoch = await s.epochs.findByNumber(ctx.worldId, n);
      if (!epoch) break;
      out.push({ number: n, journal: await s.journal.read(epoch.id) });
    }
    return out;
  });
}

async function scene(rest: readonly string[], ctx: Context, state: SimState): Promise<Report> {
  const query = need(rest, 0, 'l’identifiant de la scène');
  const names = namesOf(state.characters);
  const epochs = await readAllEpochs(ctx);
  const all = epochs.flatMap((e) =>
    e.journal.scenes.map((sc) => ({ id: sc.id, epoch: e.number, journal: e.journal, sc })),
  );
  const hit = byPrefix(all, query, 'Scène');
  const { journal, sc } = hit;
  const place = state.locations[sc.locationId]?.name ?? sc.locationId;
  const presences = journal.presences.filter((p) => p.sceneId === sc.id);
  const interactions = journal.interactions.filter((i) => i.sceneId === sc.id);
  const utterances = journal.utterances.filter((u) => interactions.some((i) => i.id === u.interactionId));

  const payload = {
    scene: {
      id: sc.id,
      epoch: hit.epoch,
      kind: sc.kind,
      location: place,
      tickStart: sc.tickStart,
      tickEnd: sc.tickEnd,
    },
    presences: presences.map((p) => ({
      character: nameOf(names, p.characterId),
      role: p.role,
      tickStart: p.tickStart,
      tickEnd: p.tickEnd,
    })),
    interactions: interactions.map((i) => ({
      id: i.id,
      action: i.action,
      outcome: i.outcome,
      mode: i.mode,
      initiator: nameOf(names, i.initiatorId),
      tickStart: i.tickStart,
      participants: i.participants.map((p) => ({ character: nameOf(names, p.characterId), role: p.role })),
      utterances: utterances
        .filter((u) => u.interactionId === i.id)
        .map((u) => ({
          seq: u.seq,
          tick: u.tick,
          speaker: nameOf(names, u.speakerId),
          addressees: u.addresseeIds.map((a) => nameOf(names, a)),
          text: u.text,
          tone: u.tone,
          emotion: u.emotion,
        })),
    })),
  };
  const lines = [
    `Scène ${sc.id} — ${sc.kind} à ${place} (époque ${String(hit.epoch)}, ticks ${String(sc.tickStart)}→${sc.tickEnd === null ? '…' : String(sc.tickEnd)})`,
    `Présences (${String(presences.length)})`,
    ...payload.presences.map(
      (p) =>
        `  - ${p.character} [${ROLE_FR[p.role ?? ''] ?? p.role ?? '—'}] ticks ${String(p.tickStart)}→${p.tickEnd === null ? '…' : String(p.tickEnd)}`,
    ),
    `Interactions (${String(interactions.length)})`,
    ...payload.interactions.flatMap((i) => [
      `  - tick ${String(i.tickStart)} · ${i.action} par ${i.initiator} → ${
        i.participants
          .filter((p) => p.character !== i.initiator)
          .map((p) => p.character)
          .join(', ') || '—'
      } : ${i.outcome ?? 'sans issue'} (${i.mode === 'dialogue' ? 'dialogue' : 'résumé'})`,
      ...i.utterances.map(
        (u) =>
          `      ${u.speaker}${u.addressees.length > 0 ? ` → ${u.addressees.join(', ')}` : ''} : « ${u.text} »${u.tone ? ` (${u.tone})` : ''}`,
      ),
    ]),
  ];
  return [payload, lines];
}

// ───── provenance ─────

async function provenance(rest: readonly string[], ctx: Context, state: SimState): Promise<Report> {
  const who = findCharacter(state, need(rest, 0, 'le personnage'));
  const fact = byPrefix(Object.values(state.facts), need(rest, 1, 'l’identifiant du fait'), 'Fait');
  const names = namesOf(state.characters);
  const { chain, events } = await ctx.storage.tx(async (s) => ({
    chain: await s.knowledge.provenance(who.id, fact.id),
    events: await s.journal.eventsOfWorld(ctx.worldId),
  }));
  if (chain.length === 0) throw new CliError(`${who.firstName} ne connaît pas ce fait.`);
  const typeOf = new Map(events.map((e) => [e.id, e.type]));

  const link = (k: KnowledgeEdge, index: number) => ({
    step: index + 1,
    character: nameOf(names, k.characterId),
    source: k.sourceType,
    toldBy: k.toldById === null ? null : nameOf(names, k.toldById),
    event: k.viaEventId === null ? null : (typeOf.get(k.viaEventId) ?? k.viaEventId),
    learnedEpoch: k.learnedEpoch,
    learnedTick: k.learnedTick,
    confidence: k.confidence,
    belief: k.belief,
  });
  const steps = chain.map(link);
  const text = renderFactText(state, fact);
  const lines = [
    `Provenance de « ${text} » pour ${who.firstName} (${String(steps.length)} maillon(s), de l’origine jusqu’au personnage)`,
    ...steps.map(
      (k) =>
        `  ${String(k.step)}. ${k.character} — ${SOURCE_FR[k.source] ?? k.source}${k.toldBy ? ` par ${k.toldBy}` : ''}${k.event ? ` via ${k.event}` : ''} (époque ${String(k.learnedEpoch)}, tick ${String(k.learnedTick)}), ${BELIEF_FR[k.belief] ?? k.belief}, confiance ${num(k.confidence)}`,
    ),
  ];
  return [{ fact: { id: fact.id, text, isTrue: fact.isTrue }, character: who.slug, chain: steps }, lines];
}

// ───── epoch ─────

async function epoch(rest: readonly string[], args: Parsed, ctx: Context, state: SimState): Promise<Report> {
  const raw = rest[0];
  const number = raw === undefined ? args.epoch : Number(raw);
  if (number === undefined || !Number.isInteger(number) || number < 0) {
    throw new CliError('inspect epoch exige un numéro d’époque : inspect epoch <n>.');
  }
  const summary = await summarizeEpoch(ctx.storage, ctx.worldId, number);
  const names = namesOf(state.characters);
  return [summary, summaryLines(summary, names, state.world.config.ticksPerEpoch)];
}
