/** WriterAgent : écrit le script de l'épisode (sortie Zod `EpisodeScript`) à partir des moments, arcs et dialogues. */
import { completeStructured } from '@ai-reality/engine';
import type { EffectRecord, Id, LLMPort, LlmTier, UtteranceRecord } from '@ai-reality/engine';
import type { EpisodeLine, EpisodeScript } from './script.js';
import { EpisodeScriptSchema } from './script.js';
import type { EpisodeSummary, Moment, NarrativeArc, ValidationIssue } from './types.js';

export interface WriterWorld {
  readonly characters: readonly { readonly id: Id; readonly firstName: string }[];
  readonly locations: readonly { readonly id: Id; readonly name: string }[];
}

export interface WriterInput {
  readonly arcs: readonly NarrativeArc[];
  readonly previously: readonly EpisodeSummary[];
  /** Matière du journal : seules ces sources et ces répliques peuvent être citées. */
  readonly moments?: readonly Moment[];
  readonly utterances?: readonly UtteranceRecord[];
  readonly effects?: readonly EffectRecord[];
  readonly confessionals?: readonly EpisodeLine[];
  readonly world?: WriterWorld;
  readonly targetSeconds?: number;
  /** Problèmes relevés par le validateur sur la tentative précédente. */
  readonly feedback?: readonly ValidationIssue[];
}

export interface WriterAgent {
  write(input: WriterInput): Promise<EpisodeScript>;
}

export interface WriterDeps {
  readonly llm: LLMPort;
  readonly retries?: number;
  readonly tier?: LlmTier;
}

export const WRITER_SYSTEM = [
  'Tu es scénariste d’une télé-réalité fictive. Tu écris le script d’un épisode en français, à partir du journal des événements fourni.',
  'Règles absolues :',
  '1. Chaque scène cite ses sources : des identifiants d’events du journal fourni, tous situés dans le lieu de la scène.',
  '2. Tu ne montres dans une scène que des personnages présents au lieu et au moment des sources citées.',
  '3. Les dialogues sont recopiés mot pour mot des répliques fournies (champ `utteranceId` obligatoire) ; ne les réécris pas.',
  '4. Les confessionnaux sont ceux fournis, recopiés mot pour mot ; la voix off est libre mais n’invente aucun fait.',
  '5. Une conséquence annoncée (`claims`) doit correspondre aux effets du journal (hausse ou baisse d’une dimension).',
  '6. Respecte la durée visée (somme des `seconds` des scènes) et termine sur un cliffhanger quand c’est possible.',
  '7. Tu réponds uniquement par un JSON valide conforme au schéma demandé, sans texte autour.',
].join('\n');

const sign = (n: number): string => `${n > 0 ? '+' : ''}${String(Math.round(n * 100) / 100)}`;

export function writerPrompt(input: WriterInput): string {
  const names = new Map((input.world?.characters ?? []).map((c) => [c.id, c.firstName]));
  const nameOf = (id: Id): string => names.get(id) ?? id;
  const lines: string[] = [];

  if (input.world) {
    lines.push('Personnages :', ...input.world.characters.map((c) => `- ${c.id} = ${c.firstName}`));
    lines.push('Lieux :', ...input.world.locations.map((l) => `- ${l.id} = ${l.name}`));
  }

  lines.push('Arcs narratifs :');
  for (const arc of input.arcs) {
    lines.push(
      `- ${arc.id} « ${arc.title} » (importance ${String(arc.importance)}) : ${arc.characterIds.map(nameOf).join(', ')} ; events ${arc.eventIds.join(', ')}`,
    );
  }

  lines.push('Moments du journal (sources possibles) :');
  for (const m of input.moments ?? []) {
    lines.push(
      `- event ${m.eventId} · tick ${String(m.tick)} · lieu ${m.locationId ?? 'inconnu'} · ${m.type} · importance ${String(m.importance)} · ${m.participantIds.map(nameOf).join(', ')}`,
    );
    for (const e of (input.effects ?? []).filter((x) => x.eventId === m.eventId)) {
      const other = e.otherCharacterId === null ? '' : ` → ${nameOf(e.otherCharacterId)}`;
      lines.push(`    effet : ${nameOf(e.characterId)}${other} ${e.dimension} ${sign(e.delta)}`);
    }
    for (const u of (input.utterances ?? []).filter((x) => m.utteranceIds.includes(x.id))) {
      lines.push(`    réplique ${u.id} · ${nameOf(u.speakerId)} : « ${u.text} »`);
    }
  }

  if ((input.confessionals ?? []).length > 0) {
    lines.push('Confessionnaux enregistrés :');
    for (const c of input.confessionals ?? []) lines.push(`- ${nameOf(c.speakerId)} (${c.speakerId}) : « ${c.text} »`);
  }

  if (input.previously.length > 0) {
    lines.push('Précédemment :');
    for (const p of input.previously) {
      lines.push(
        `- Épisode ${String(p.number)} « ${p.title} » : ${p.synopsis}${p.cliffhanger ? ` (fin : ${p.cliffhanger})` : ''}`,
      );
    }
  }

  if (input.targetSeconds !== undefined) lines.push(`Durée visée : ${String(input.targetSeconds)} secondes au total.`);
  if (input.feedback && input.feedback.length > 0) {
    lines.push(
      'Ta version précédente a été rejetée. Corrige ces problèmes :',
      ...input.feedback.map((i) => `- ${i.message}`),
    );
  }
  lines.push(
    'Réponds : {"title","synopsis","scenes":[{"locationId","characterIds","tone","summary","seconds","sources","shots":[{"kind","description","characterIds"}],"lines":[{"kind","speakerId","text","utteranceId","tone"}],"claims":[{"eventId","characterId","otherCharacterId","dimension","direction"}]}],"cliffhanger"}.',
    'Types de plan (`shots.kind`) : establishing, wide, medium, close_up, reaction, insert. Types de ligne : dialogue, confessional, voiceover.',
  );
  return lines.join('\n');
}

export function createWriterAgent(deps: WriterDeps): WriterAgent {
  return {
    async write(input) {
      const result = await completeStructured(
        deps.llm,
        {
          purpose: 'write',
          tier: deps.tier ?? 'dialogue',
          system: { stable: WRITER_SYSTEM },
          messages: [{ role: 'user', content: writerPrompt(input) }],
          output: EpisodeScriptSchema,
          maxTokens: 8_000,
        },
        { retries: deps.retries ?? 2 },
      );
      return result.data as EpisodeScript;
    },
  };
}
