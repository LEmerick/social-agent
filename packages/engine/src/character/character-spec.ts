import { z } from 'zod';

/** Autonomies connues. Toute autre valeur est rejetée à la frontière. */
export const AUTONOMIES = ['autonomous', 'guided', 'directive'] as const;

export const GOAL_KINDS = ['main', 'secondary', 'social', 'private'] as const;
export const GOAL_ORIGINS = ['player', 'ai', 'season'] as const;

export const GoalSpecSchema = z.object({
  kind: z.enum(GOAL_KINDS),
  description: z.string().trim().min(1).max(500),
  origin: z.enum(GOAL_ORIGINS).default('player'),
  targetCharacterId: z.uuid().nullable().default(null),
});

export type GoalSpec = z.infer<typeof GoalSpecSchema>;

/** Spécification saisie par le joueur, validée à la frontière. Les traits sont bornés à 0..100. */
export const CharacterSpecSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug : minuscules, chiffres et tirets'),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80).nullable().default(null),
  age: z.number().int().min(16).max(120).nullable().default(null),
  gender: z.string().trim().min(1).max(40).nullable().default(null),
  origin: z.string().trim().min(1).max(120).nullable().default(null),
  backstory: z.string().trim().min(1).max(4000).nullable().default(null),
  speechStyle: z.string().trim().min(1).max(500).nullable().default(null),
  autonomy: z.enum(AUTONOMIES),
  traits: z.record(
    z.string().min(1).max(40),
    z.number().int().min(0, 'trait hors 0..100').max(100, 'trait hors 0..100'),
  ),
  goals: z.array(GoalSpecSchema).max(20).default([]),
});

export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;
