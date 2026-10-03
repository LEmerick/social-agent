/**
 * Détection des époques corrompues (`ai-reality doctor`) : contrôles structurels du journal, puis rejeu complet.
 * Chaque anomalie est un `Finding` ; une saison saine ne renvoie aucun constat.
 */
import type { StoragePort } from '../ports/storage.js';
import { loadSimState } from '../state/load.js';
import type { Id, SimState } from '../state/types.js';
import type { Finding } from './findings.js';
import { replayData } from './replay-season.js';
import { type EpochData, type SeasonData, loadSeasonData } from './season-data.js';

export interface AuditReport {
  readonly ok: boolean;
  readonly epochs: number;
  readonly stateHash: string;
  readonly issues: Finding[];
}

export async function auditSeason(storage: StoragePort, worldId: Id, seasonNumber: number): Promise<AuditReport> {
  const data = await loadSeasonData(storage, worldId, seasonNumber);
  const base = await loadSimState(storage, worldId, seasonNumber);
  return auditData(data, base);
}

export function auditData(data: SeasonData, base: Readonly<SimState>): AuditReport {
  const slug = (id: Id): string => base.characters[id]?.slug ?? id.slice(0, 8);
  const issues: Finding[] = [...structural(data, slug)];
  const replay = replayData(data, base);
  // Une époque non terminée est déjà signalée par le contrôle structurel.
  issues.push(...replay.diffs.filter((d) => d.kind !== 'epoch_unfinished'));
  return { ok: issues.length === 0, epochs: data.epochs.length, stateHash: replay.stateHash, issues };
}

function structural(data: SeasonData, slug: (id: Id) => string): Finding[] {
  const out: Finding[] = [];
  const { ticksPerEpoch } = data.config;

  for (const id of data.danglingEpochIds) {
    out.push({
      kind: 'epoch_gap',
      epoch: null,
      message: `Des events référencent l'époque ${id}, absente de la suite continue des époques du monde.`,
    });
  }
  data.epochs.forEach((ed, i) => {
    const expected = (data.epochs[0]?.epoch.number ?? 0) + i;
    if (ed.epoch.number !== expected) {
      out.push({
        kind: 'epoch_gap',
        epoch: ed.epoch.number,
        message: `Trou dans les époques de la saison : l'époque ${String(expected)} manque avant la ${String(ed.epoch.number)}.`,
      });
    }
    out.push(...epochChecks(ed, ticksPerEpoch, slug, data));
  });
  out.push(...seqGaps(data));
  return out;
}

function epochChecks(ed: EpochData, ticksPerEpoch: number, slug: (id: Id) => string, data: SeasonData): Finding[] {
  const out: Finding[] = [];
  const { epoch, journal } = ed;
  const n = epoch.number;

  if (epoch.status === 'running' || epoch.status === 'failed') {
    out.push({
      kind: 'epoch_unfinished',
      epoch: n,
      message: `Époque ${String(n)} ${epoch.status === 'running' ? 'interrompue (running)' : 'en échec (failed)'} à la suite du tick ${String(epoch.lastCommittedTick)} : à reprendre.`,
    });
  }
  const last = epoch.lastCommittedTick;
  if (epoch.status === 'completed' && last !== ticksPerEpoch) {
    out.push({
      kind: 'commit_mismatch',
      epoch: n,
      message: `Époque ${String(n)} terminée mais dernier tick validé ${String(last)} au lieu de ${String(ticksPerEpoch)}.`,
    });
  }
  const ticks = [
    ...journal.events.map((e) => e.tick),
    ...journal.effects.map((e) => e.tick),
    ...journal.decisions.map((d) => d.tick),
    ...journal.interactions.map((i) => i.tickStart),
    ...journal.scenes.map((s) => s.tickStart),
    ...journal.presences.map((p) => p.tickStart),
  ];
  const beyond = Math.max(-1, ...ticks);
  if (beyond > last) {
    out.push({
      kind: 'commit_mismatch',
      epoch: n,
      message: `Époque ${String(n)} : des enregistrements existent au tick ${String(beyond)}, après le dernier tick validé (${String(last)}).`,
    });
  }

  const eventIds = new Set(journal.events.map((e) => e.id));
  const orphans = journal.effects.filter((fx) => !eventIds.has(fx.eventId));
  for (const fx of orphans) {
    out.push({
      kind: 'effect_orphan',
      epoch: n,
      path: `effect.${fx.id}`,
      message: `Époque ${String(n)}, tick ${String(fx.tick)} : effet ${fx.id} (${fx.ruleId}) sans event ${fx.eventId}.`,
    });
  }

  if (epoch.status === 'completed') {
    out.push(...presenceChecks(ed, ticksPerEpoch, slug));
    const rows = new Set(ed.states.map((r) => r.characterId));
    for (const c of data.characters) {
      if (!rows.has(c.id)) {
        out.push({
          kind: 'state_missing',
          epoch: n,
          path: `char.${c.id}`,
          message: `Époque ${String(n)} : aucune ligne character_state pour ${slug(c.id)}.`,
        });
      }
    }
  }
  return out;
}

/** Chaque personnage doit être présent (scène, transit ou hors-scène) sans interruption sur [0, ticksPerEpoch). */
function presenceChecks(ed: EpochData, ticksPerEpoch: number, slug: (id: Id) => string): Finding[] {
  const out: Finding[] = [];
  const n = ed.epoch.number;
  const byCharacter = new Map<Id, EpochData['journal']['presences']>();
  for (const p of ed.journal.presences) byCharacter.set(p.characterId, [...(byCharacter.get(p.characterId) ?? []), p]);
  for (const row of ed.states) {
    const list = [...(byCharacter.get(row.characterId) ?? [])].sort((a, b) => a.tickStart - b.tickStart);
    const problem = ((): string | null => {
      const first = list[0];
      if (!first) return 'aucune présence';
      if (first.tickStart !== 0) return `commence au tick ${String(first.tickStart)}`;
      let cursor = 0;
      for (const p of list) {
        if (p.tickStart !== cursor) return `trou entre les ticks ${String(cursor)} et ${String(p.tickStart)}`;
        if (p.tickEnd === null) return `présence ouverte depuis le tick ${String(p.tickStart)}`;
        cursor = p.tickEnd;
      }
      return cursor === ticksPerEpoch ? null : `s'arrête au tick ${String(cursor)} sur ${String(ticksPerEpoch)}`;
    })();
    if (problem) {
      out.push({
        kind: 'presence',
        epoch: n,
        path: `char.${row.characterId}.presence`,
        message: `Époque ${String(n)} : présence de ${slug(row.characterId)} incomplète sur [0, ${String(ticksPerEpoch)}) : ${problem}.`,
      });
    }
  }
  return out;
}

/** `seq` est un ordre total sans trou : un trou signale des events (donc un tick) perdus. */
function seqGaps(data: SeasonData): Finding[] {
  const out: Finding[] = [];
  const epochOf = new Map(data.epochs.map((e) => [e.epoch.id, e.epoch.number]));
  const events = data.events;
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const cur = events[i];
    if (!prev || !cur || cur.seq === prev.seq + 1) continue;
    out.push({
      kind: 'seq_gap',
      epoch: epochOf.get(cur.epochId) ?? null,
      message: `Trou dans la suite des events : seq ${String(prev.seq)} (tick ${String(prev.tick)}) puis ${String(cur.seq)} (tick ${String(cur.tick)}) : ${String(cur.seq - prev.seq - 1)} event(s) manquant(s).`,
    });
    if (prev.epochId === cur.epochId && cur.tick > prev.tick) {
      out.push({
        kind: 'tick_gap',
        epoch: epochOf.get(cur.epochId) ?? null,
        message: `Ticks manquants probables entre le tick ${String(prev.tick)} et le tick ${String(cur.tick)}.`,
      });
    }
  }
  return out;
}
