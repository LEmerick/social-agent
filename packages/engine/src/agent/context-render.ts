/** Rendu texte (français) d'un `AgentContext` pour un prompt. Ne lit que le contexte : aucune fuite possible. */
import type { AgentContext, KnownFactView } from './context.js';

const SOURCE_FR: Record<string, string> = {
  seeded: 'su depuis le début',
  public: 'de notoriété publique',
  witnessed: 'vu ou entendu de vos propres yeux',
  overheard: 'entendu en écoutant discrètement',
  told: 'raconté',
  inferred: 'déduit',
};
const BELIEF_FR = { believes: 'vous y croyez', doubts: 'vous doutez', disbelieves: "vous n'y croyez pas" } as const;
const SENSITIVITY_FR = ['public', 'discret', 'sensible', 'secret'];

const pct = (n: number): string => `${String(Math.round(n * 100))} %`;
const entries = (r: Readonly<Record<string, number>>): string =>
  Object.entries(r)
    .map(([k, v]) => `${k} ${String(Math.round(v))}`)
    .join(', ');

function renderFact(f: KnownFactView): string {
  const p = f.provenance;
  const who = p.toldByName ? ` par ${p.toldByName}` : '';
  const since = `époque ${String(p.learnedEpoch)}, tick ${String(p.learnedTick)}`;
  return `- [${f.factId}] ${f.text} (${SENSITIVITY_FR[f.sensitivity] ?? 'inconnu'} ; confiance ${pct(f.confidence)}, ${BELIEF_FR[f.belief]} ; ${SOURCE_FR[p.source] ?? p.source}${who}, ${since})`;
}

export function renderAgentContext(ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push(`Vous êtes ${ctx.identity.firstName} (${ctx.identity.slug}).`);
  if (Object.keys(ctx.identity.traits).length > 0) lines.push(`Traits : ${entries(ctx.identity.traits)}.`);
  lines.push(`État : ${entries(ctx.stats)} ; crédits ${String(ctx.credits)}.`);
  if (Object.keys(ctx.mood).length > 0) lines.push(`Humeur : ${entries(ctx.mood)}.`);

  lines.push('', 'Objectifs :');
  if (ctx.goals.length === 0) lines.push('- aucun');
  for (const g of ctx.goals)
    lines.push(`- (${g.kind}) ${g.description}${g.targetName ? ` — visant ${g.targetName}` : ''}`);

  lines.push('', 'Intentions en cours :');
  if (ctx.agenda.length === 0) lines.push('- aucune');
  for (const i of ctx.agenda) {
    const fact = i.factId ? ` à propos du fait [${i.factId}]` : '';
    lines.push(`- ${i.kind}${i.targetName ? ` ${i.targetName}` : ''}${fact} (priorité ${i.priority.toFixed(2)})`);
  }

  lines.push('', 'Vos relations (votre ressenti) :');
  if (ctx.relationships.length === 0) lines.push('- aucune');
  for (const r of ctx.relationships) {
    const labels = r.labels.length > 0 ? ` [${r.labels.join(', ')}]` : '';
    lines.push(`- ${r.targetName} (${r.acquaintance}) : ${entries(r.axes)}${labels}`);
  }

  lines.push('', 'Ce que vous savez (et rien de plus) :');
  if (ctx.knowledge.length === 0) lines.push('- rien de notable');
  for (const f of ctx.knowledge) lines.push(renderFact(f));

  lines.push('', 'Situation :');
  lines.push(`Lieu : ${ctx.situation.locationName ?? 'inconnu'}.`);
  lines.push(
    `Présents : ${ctx.situation.members.length > 0 ? ctx.situation.members.map((m) => m.name).join(', ') : 'personne'}.`,
  );
  if (ctx.situation.previousTurns.length > 0) {
    lines.push('Échange en cours :');
    for (const t of ctx.situation.previousTurns) lines.push(`${t.speakerName} : ${t.text}`);
  }
  return lines.join('\n');
}
