/**
 * DSL de conditions (game-formats.md §3.2) : des prédicats purs sur le `SimState`, évalués par le moteur
 * (jamais par le LLM). Un objet portant plusieurs clés est un ET implicite (`{ not: …, epoch_gte: 6 }`).
 *
 * Références de personnage (`who`, `with`, `from`, `to`, `target`, `subject`) :
 * `'$self'` (le titulaire), `'$team'` (les membres de son équipe), `'?'` (n'importe quel personnage) ou un identifiant.
 */
import { z } from 'zod';

export interface Cmp {
  readonly gte?: number;
  readonly lte?: number;
  readonly gt?: number;
  readonly lt?: number;
  readonly eq?: number;
}

export type Quantifier = 'any' | 'all';

export interface Condition {
  readonly holds?: { readonly who: string; readonly item: string; readonly count?: Cmp };
  readonly knows?: {
    readonly who: string;
    readonly fact: { readonly predicate: string; readonly subject?: string; readonly object?: string };
    readonly minConfidence?: number;
    readonly quantifier?: Quantifier;
  };
  readonly relationship?: {
    readonly from: string;
    readonly to: string;
    readonly axis: string;
    readonly cmp: Cmp;
    /** Les deux sens doivent satisfaire la comparaison (`alliance(A↔moi)`). */
    readonly mutual?: boolean;
    readonly quantifier?: Quantifier;
  };
  readonly stat?: { readonly who: string; readonly stat: string; readonly cmp: Cmp; readonly quantifier?: Quantifier };
  readonly action_done?: {
    readonly who: string;
    readonly action: string;
    readonly target?: string;
    readonly count?: Cmp;
    readonly quantifier?: Quantifier;
  };
  /** Au moins `ticks` ticks passés en scène ensemble. */
  readonly present_with?: { readonly who: string; readonly with: string; readonly ticks: number };
  /** Résultat du dernier décompte (ou de la session donnée). */
  readonly vote_result?: {
    readonly session?: string;
    readonly kind?: 'elimination' | 'designation' | 'public';
    readonly eliminated?: string;
    readonly tied?: boolean;
  };
  readonly count_active?: Cmp;
  /** L'époque courante est ≥ n. */
  readonly epoch_gte?: number;
  /** L'époque courante n'est pas après `epoch` (borne incluse) ; `'$deadline'` = échéance de la mission. */
  readonly before?: { readonly epoch: number | '$deadline' };
  readonly not?: Condition;
  readonly all?: readonly Condition[];
  readonly any?: readonly Condition[];
  /** Nombre de sous-conditions satisfaites, comparé à `cmp`. */
  readonly count?: { readonly of: readonly Condition[]; readonly cmp: Cmp };
}

const num = z.number();
export const CmpSchema = z
  .object({ gte: num.optional(), lte: num.optional(), gt: num.optional(), lt: num.optional(), eq: num.optional() })
  .strict() as unknown as z.ZodType<Cmp>;
const ref = z.string().min(1);
const quantifier = z.enum(['any', 'all']).optional();

/** Une comparaison peut être écrite à plat (`{ gte: 3 }`) : on l'accepte telle quelle. */
const cmpField = CmpSchema;

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z
    .object({
      holds: z.object({ who: ref, item: ref, count: cmpField.optional() }).strict().optional(),
      knows: z
        .object({
          who: ref,
          fact: z.object({ predicate: ref, subject: ref.optional(), object: ref.optional() }).strict(),
          minConfidence: z.number().min(0).max(1).optional(),
          quantifier,
        })
        .strict()
        .optional(),
      relationship: z
        .object({
          from: ref,
          to: ref,
          axis: ref,
          cmp: cmpField,
          mutual: z.boolean().optional(),
          quantifier,
        })
        .strict()
        .optional(),
      stat: z.object({ who: ref, stat: ref, cmp: cmpField, quantifier }).strict().optional(),
      action_done: z
        .object({ who: ref, action: ref, target: ref.optional(), count: cmpField.optional(), quantifier })
        .strict()
        .optional(),
      present_with: z
        .object({ who: ref, with: ref, ticks: z.number().int().min(1) })
        .strict()
        .optional(),
      vote_result: z
        .object({
          session: ref.optional(),
          kind: z.enum(['elimination', 'designation', 'public']).optional(),
          eliminated: ref.optional(),
          tied: z.boolean().optional(),
        })
        .strict()
        .optional(),
      count_active: cmpField.optional(),
      epoch_gte: z.number().int().min(0).optional(),
      before: z
        .object({ epoch: z.union([z.number().int().min(0), z.literal('$deadline')]) })
        .strict()
        .optional(),
      not: ConditionSchema.optional(),
      all: z.array(ConditionSchema).optional(),
      any: z.array(ConditionSchema).optional(),
      count: z
        .object({ of: z.array(ConditionSchema), cmp: cmpField })
        .strict()
        .optional(),
    })
    .strict()
    .refine((c) => Object.values(c).some((v) => v !== undefined), { message: 'Condition vide' }),
) as z.ZodType<Condition>;

/** Valide une condition (`DomainError` côté appelant : ici on renvoie le résultat Zod). */
export const parseCondition = (input: unknown): Condition => ConditionSchema.parse(input);
