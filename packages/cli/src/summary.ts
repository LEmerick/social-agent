/** Résumé d'une époque jouée : volumes du journal, répartition des actions, événements importants. */
import type { EpochRecord, EventRecord, Id, StoragePort } from '@ai-reality/engine';
import { journalHash } from '@ai-reality/engine';
import { CliError } from './io.js';
import { EPOCH_STATUS_FR, type Names, nameOf, num } from './fr.js';

export interface EventLine {
  readonly seq: number;
  readonly tick: number;
  readonly type: string;
  readonly importance: number;
  readonly actors: readonly Id[];
  readonly targets: readonly Id[];
  readonly witnesses: number;
}

export interface EpochSummary {
  readonly number: number;
  readonly epochId: Id;
  readonly status: EpochRecord['status'];
  readonly lastCommittedTick: number;
  readonly scenes: number;
  readonly sceneList: readonly {
    readonly id: Id;
    readonly kind: string;
    readonly tickStart: number;
    readonly tickEnd: number | null;
  }[];
  readonly interactions: number;
  readonly utterances: number;
  readonly decisions: number;
  readonly events: number;
  readonly effects: number;
  readonly statusChanges: number;
  readonly actions: Readonly<Record<string, number>>;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly important: readonly EventLine[];
  readonly journalHash: string;
}

const IMPORTANT = 0.5;
const MAX_IMPORTANT = 10;

const count = (values: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

const lineOf = (e: EventRecord): EventLine => ({
  seq: e.seq,
  tick: e.tick,
  type: e.type,
  importance: e.importance,
  actors: e.participants.filter((p) => p.role === 'actor').map((p) => p.characterId),
  targets: e.participants.filter((p) => p.role === 'target' || p.role === 'subject').map((p) => p.characterId),
  witnesses: e.participants.filter((p) => p.role === 'witness').length,
});

export async function summarizeEpoch(storage: StoragePort, worldId: Id, number: number): Promise<EpochSummary> {
  const { epoch, journal } = await storage.tx(async (s) => {
    const found = await s.epochs.findByNumber(worldId, number);
    if (!found) throw new CliError(`Époque ${String(number)} introuvable.`);
    return { epoch: found, journal: await s.journal.read(found.id) };
  });
  const important = journal.events
    .filter((e) => e.importance >= IMPORTANT)
    .sort((a, b) => b.importance - a.importance || a.seq - b.seq)
    .slice(0, MAX_IMPORTANT)
    .map(lineOf);
  return {
    number,
    epochId: epoch.id,
    status: epoch.status,
    lastCommittedTick: epoch.lastCommittedTick,
    scenes: journal.scenes.length,
    sceneList: journal.scenes.map((sc) => ({ id: sc.id, kind: sc.kind, tickStart: sc.tickStart, tickEnd: sc.tickEnd })),
    interactions: journal.interactions.length,
    utterances: journal.utterances.length,
    decisions: journal.decisions.length,
    events: journal.events.length,
    effects: journal.effects.length,
    statusChanges: journal.events.filter((e) => e.type === 'status_changed').length,
    actions: count(journal.interactions.map((i) => i.action)),
    outcomes: count(journal.interactions.flatMap((i) => (i.outcome === null ? [] : [i.outcome]))),
    important,
    journalHash: journalHash(journal.events),
  };
}

export function eventText(line: EventLine, names: Names): string {
  const who = line.actors.map((id) => nameOf(names, id)).join(', ');
  const whom = line.targets.map((id) => nameOf(names, id)).join(', ');
  const link = who && whom ? `${who} → ${whom}` : who || whom;
  const witnesses = line.witnesses > 0 ? ` (${String(line.witnesses)} témoin${line.witnesses > 1 ? 's' : ''})` : '';
  return `tick ${String(line.tick)} · ${line.type} [importance ${num(line.importance)}] ${link}${witnesses}`.trimEnd();
}

const list = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([k, n]) => `${k} ×${String(n)}`)
    .join(', ') || '—';

export function summaryLines(s: EpochSummary, names: Names, ticksPerEpoch: number): string[] {
  return [
    `Époque ${String(s.number)} — ${EPOCH_STATUS_FR[s.status] ?? s.status} (dernier tick validé ${String(s.lastCommittedTick)} sur ${String(ticksPerEpoch)})`,
    `  Scènes ${String(s.scenes)} · interactions ${String(s.interactions)} · répliques ${String(s.utterances)} · décisions ${String(s.decisions)}`,
    ...s.sceneList.map(
      (sc) =>
        `    scène ${sc.id} (${sc.kind}, ticks ${String(sc.tickStart)}→${sc.tickEnd === null ? '…' : String(sc.tickEnd)})`,
    ),
    `  Events ${String(s.events)} · effets ${String(s.effects)} · changements de statut ${String(s.statusChanges)}`,
    `  Actions : ${list(s.actions)}`,
    `  Issues : ${list(s.outcomes)}`,
    `  Empreinte du journal : ${s.journalHash.slice(0, 16)}`,
    s.important.length > 0
      ? `  Événements importants (${String(s.important.length)}) :`
      : '  Aucun événement important.',
    ...s.important.map((e) => `    - ${eventText(e, names)}`),
  ];
}
