import { z } from 'zod';

/** Autonomies connues. Toute autre valeur est rejetée à la frontière. */
export const AUTONOMIES = ['autonomous', 'guided', 'directive'] as const;

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
  autonomy: z.enum(AUTONOMIES),
  traits: z.record(
    z.string().min(1).max(40),
    z.number().int().min(0, 'trait hors 0..100').max(100, 'trait hors 0..100'),
  ),
});

export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;
