/**
 * Script d'épisode : sortie structurée du WriterAgent. Chaque scène cite ses sources (ids d'events du journal) ;
 * les dialogues renvoient à des utterances, les affirmations de conséquence (`claims`) au journal des effets.
 */
import { z } from '@ai-reality/engine';

export const SHOT_KINDS = ['establishing', 'wide', 'medium', 'close_up', 'reaction', 'insert'] as const;
export const LINE_KINDS = ['dialogue', 'confessional', 'voiceover'] as const;

export const ShotSchema = z.object({
  kind: z.enum(SHOT_KINDS),
  description: z.string().min(1),
  characterIds: z.array(z.string()),
});

export const ScriptLineSchema = z.object({
  kind: z.enum(LINE_KINDS),
  /** `null` pour la voix off. */
  speakerId: z.string().nullable(),
  text: z.string().min(1),
  /** Utterance du journal d'où le dialogue est tiré (obligatoire pour un dialogue). */
  utteranceId: z.string().nullable(),
  tone: z.string().nullable(),
});

/** « Cet event a fait monter/baisser telle dimension entre ces deux personnages » : vérifié contre les effets. */
export const ClaimSchema = z.object({
  eventId: z.string(),
  characterId: z.string(),
  otherCharacterId: z.string().nullable(),
  dimension: z.string().min(1),
  direction: z.enum(['up', 'down']),
});

export const ScriptSceneSchema = z.object({
  locationId: z.string(),
  characterIds: z.array(z.string()),
  tone: z.string().min(1),
  summary: z.string().min(1),
  seconds: z.number().int().min(1),
  /** Ids d'events du journal qui fondent la scène. */
  sources: z.array(z.string()).min(1),
  shots: z.array(ShotSchema),
  lines: z.array(ScriptLineSchema),
  claims: z.array(ClaimSchema),
});

export const EpisodeScriptSchema = z.object({
  title: z.string().min(1),
  synopsis: z.string().min(1),
  scenes: z.array(ScriptSceneSchema).min(1),
  cliffhanger: z.string().nullable(),
});

export type Shot = z.infer<typeof ShotSchema>;
export type ScriptLine = z.infer<typeof ScriptLineSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;
export type EpisodeScript = z.infer<typeof EpisodeScriptSchema>;

/** Ligne enregistrée hors script (confessionnal) : même forme qu'une ligne de script, plus la traçabilité. */
export interface EpisodeLine extends ScriptLine {
  readonly kind: 'confessional';
  readonly speakerId: string;
  readonly arcId: string;
  readonly revealedFactIds: readonly string[];
  readonly llmCallId: string;
}
