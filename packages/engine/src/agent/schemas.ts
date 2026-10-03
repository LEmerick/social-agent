/**
 * Schémas Zod des sorties LLM de l'agent (engine-architecture.md §7). Les identifiants de personnages ne sont jamais
 * demandés au modèle : il cite des prénoms, que le runtime résout en identifiants à partir du contexte.
 * Les bornes (`min`, `max`) sont revérifiées côté client même si le fournisseur ne les impose pas.
 */
import { z } from '../llm/index.js';

export const INTENTION_KINDS = ['talk_to', 'avoid', 'attend', 'tell', 'go_to'] as const;

export const PlanSchema = z.object({
  intentions: z
    .array(
      z.object({
        kind: z.enum(INTENTION_KINDS),
        /** Prénom du personnage visé. */
        target: z.string().nullable(),
        goal: z.string().nullable(),
        /** Identifiant d'un fait de « Ce que vous savez » (intention `tell`). */
        factId: z.string().nullable(),
        /** Nom du lieu (intention `go_to`). */
        location: z.string().nullable(),
        priority: z.number().min(0).max(1),
      }),
    )
    .max(6),
});
export type PlanOutput = z.infer<typeof PlanSchema>;

export const SpeakSchema = z.object({
  text: z.string().min(1),
  intent: z.string(),
  tone: z.string(),
  emotion: z.string(),
  /** Identifiants des faits que la réplique révèle (uniquement ceux de « Ce que vous savez »). */
  reveals: z.array(z.string()),
  /** Prénoms des personnes citées. */
  mentions: z.array(z.string()),
  wantsToContinue: z.boolean(),
});
export type SpeakOutput = z.infer<typeof SpeakSchema>;

export const BELIEFS = ['believes', 'doubts', 'disbelieves'] as const;

export const ReflectSchema = z.object({
  beliefs: z
    .array(
      z.object({
        factId: z.string(),
        belief: z.enum(BELIEFS),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8),
  goalUpdates: z
    .array(
      z.object({
        /** Rang (à partir de 0) dans la liste numérotée des objectifs ouverts. */
        goalIndex: z.number().int().min(0),
        status: z.enum(['achieved', 'abandoned']),
      }),
    )
    .max(6),
});
export type ReflectOutput = z.infer<typeof ReflectSchema>;

export const InterviewSchema = z.object({
  answer: z.string().min(1),
  reveals: z.array(z.string()),
});
export type InterviewOutput = z.infer<typeof InterviewSchema>;

/** Choix d'une option numérotée (`"3"`) ou `"none"`. `distribution` : probabilités par option, si le modèle en donne. */
export const ChoiceSchema = z.object({
  choice: z.string(),
  distribution: z.array(z.object({ choice: z.string(), p: z.number().min(0).max(1) })).optional(),
  reason: z.string().optional(),
});
export type ChoiceOutput = z.infer<typeof ChoiceSchema>;

export const OutcomeJudgeSchema = z.object({
  outcome: z.string(),
  distribution: z.array(z.object({ outcome: z.string(), p: z.number().min(0).max(1) })).optional(),
  reason: z.string().optional(),
});
export type OutcomeJudgeOutput = z.infer<typeof OutcomeJudgeSchema>;

export const VerifySchema = z.object({
  coherent: z.boolean(),
  reason: z.string(),
});
export type VerifyOutput = z.infer<typeof VerifySchema>;

/** Sortie brute de la compilation d'une directive : les cibles sont des prénoms. */
export const DirectiveCompileSchema = z.object({
  actions: z.record(z.string(), z.number()),
  targets: z.record(z.string(), z.number()),
  prefer: z.array(z.string()),
  forbid: z.array(z.string()),
});
export type DirectiveCompileOutput = z.infer<typeof DirectiveCompileSchema>;

/** Forme stockée dans `character_directive.biases` (action-catalog.md §7). */
export const DirectiveBiasesSchema = z.object({
  actions: z.record(z.string(), z.number()),
  targets: z.record(z.string(), z.number()),
  prefer: z.array(z.string()),
  forbid: z.array(z.string()),
});
