/** Rendu texte de l’interface : des fonctions pures qui rendent des lignes à partir de la session. */
import { STAT_FR, STATUS_FR } from '../session/fr.js';
import type { PlaySession } from '../session/create-session.js';
import type { EpochSummary, PlayEvent, PlayEventKind, PlayRequest } from '../session/types.js';
import type { Style } from './ansi.js';

const KIND_MARK: Readonly<Record<PlayEventKind, string>> = {
  heard: '»',
  acted: '▶',
  seen: '~',
  arrived: '→',
  left: '←',
  learned: '★',
  relation: '♦',
  credits: '¤',
  status: '!',
};

const AXIS_ORDER = ['trust', 'affection', 'alliance', 'respect', 'rivalry', 'fear', 'attraction'] as const;
const AXIS_LABEL: Readonly<Record<string, string>> = {
  trust: 'confiance',
  affection: 'affection',
  alliance: 'alliance',
  respect: 'respect',
  rivalry: 'rivalité',
  fear: 'crainte',
  attraction: 'attirance',
};

export const HELP = 'Raccourcis : r relations · k ce que je sais · l journal · q quitter';

export function rule(style: Style, title = ''): string {
  const line = '─'.repeat(Math.max(4, 60 - title.length - 2));
  return style.dim(title === '' ? line : `── ${title} ${line}`.slice(0, 64));
}

export function headerLines(session: PlaySession, style: Style): string[] {
  const c = session.clock();
  const s = session.status();
  const where = s.moving ? 'en chemin' : s.place === null ? 'hors-champ' : `${s.place}${s.zone ? ` (${s.zone})` : ''}`;
  const stats = Object.entries(s.stats)
    .map(([k, v]) => `${STAT_FR[k] ?? k} ${String(Math.round(v))}`)
    .join(' · ');
  return [
    style.bold(style.cyan(`AI Reality — tu es ${s.name}`)),
    `Époque ${String(c.epoch + 1)} · tick ${String(c.tick)}/${String(c.ticksPerEpoch)} · ${style.bold(c.time)} · ${style.yellow(where)}`,
    `${stats} · crédits ${style.bold(String(s.credits))} · ${STATUS_FR[s.status]}`,
    s.moving || s.place === null
      ? style.dim('Tu ne vois personne.')
      : s.present.length > 0
        ? `Présents : ${style.green(s.present.join(', '))}`
        : style.dim('Personne d’autre ici.'),
  ];
}

export function eventLine(e: PlayEvent, style: Style): string {
  const color = (text: string): string => {
    switch (e.kind) {
      case 'heard':
        return style.bold(text);
      case 'acted':
        return style.cyan(text);
      case 'learned':
        return style.magenta(text);
      case 'relation':
      case 'credits':
        return style.yellow(text);
      case 'status':
        return style.red(text);
      default:
        return style.dim(text);
    }
  };
  return `${style.dim(e.time)} ${color(`${KIND_MARK[e.kind]} ${e.text}`)}`;
}

export function feedLines(events: readonly PlayEvent[], style: Style): string[] {
  return events.length === 0 ? [style.dim('(rien de nouveau)')] : events.map((e) => eventLine(e, style));
}

export function requestLines(request: PlayRequest, style: Style): string[] {
  const lines = [style.bold(request.prompt)];
  let group: string | undefined;
  for (const o of request.options) {
    if (o.group !== undefined && o.group !== group) {
      group = o.group;
      lines.push(style.cyan(`  ${group}`));
    }
    lines.push(`  ${style.bold(String(o.n).padStart(2))}) ${o.label}`);
  }
  return lines;
}

export function relationsLines(session: PlaySession, style: Style): string[] {
  const rels = session.relations();
  if (rels.length === 0) return [style.dim('Tu n’as encore de lien avec personne.')];
  return rels.flatMap((r) => {
    const axes = AXIS_ORDER.filter((a) => (r.axes[a] ?? 0) !== 0)
      .map((a) => `${AXIS_LABEL[a] ?? a} ${String(r.axes[a])}`)
      .join(' · ');
    const labels = r.labels.length > 0 ? ` [${r.labels.join(', ')}]` : '';
    return [
      `${style.bold(r.name)} (${r.acquaintance})${labels}`,
      `  ${axes === '' ? style.dim('aucun sentiment marqué') : axes}`,
    ];
  });
}

export function knowledgeLines(session: PlaySession, style: Style): string[] {
  const facts = session.knowledge();
  if (facts.length === 0) return [style.dim('Tu ne sais rien de particulier pour l’instant.')];
  return facts.map((k) => `${style.magenta('★')} ${k.text} ${style.dim(`(${k.source} ; ${k.belief})`)}`);
}

export function journalLines(session: PlaySession, style: Style, last = 40): string[] {
  const log = session.log().slice(-last);
  return log.length === 0 ? [style.dim('Le journal est vide.')] : log.map((e) => eventLine(e, style));
}

const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n));

export function summaryLines(summary: EpochSummary, style: Style): string[] {
  const lines = [
    style.bold(style.cyan(`Fin de l’époque ${String(summary.epoch + 1)}`)),
    `Crédits : ${String(summary.creditsBefore)} → ${style.bold(String(summary.creditsAfter))} (${signed(summary.creditsAfter - summary.creditsBefore)})`,
    `Statut : ${STATUS_FR[summary.statusBefore]}${summary.statusBefore === summary.statusAfter ? '' : ` → ${style.red(STATUS_FR[summary.statusAfter])}`}`,
    `Interactions vécues : ${String(summary.interactions)} · choses apprises : ${String(summary.learned)}`,
  ];
  if (summary.relationChanges.length === 0) {
    lines.push(style.dim('Tes sentiments envers les autres n’ont pas bougé.'));
  } else {
    lines.push('Tes sentiments qui ont le plus changé :');
    for (const c of summary.relationChanges.slice(0, 4)) {
      const detail = Object.entries(c.deltas)
        .map(([axis, d]) => `${AXIS_LABEL[axis] ?? axis} ${signed(d)}`)
        .join(', ');
      lines.push(`  ${style.bold(c.name)} : ${detail}`);
    }
  }
  return lines;
}
