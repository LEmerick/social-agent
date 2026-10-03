import { z } from 'zod';

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug : minuscules, chiffres et tirets');

export const ZoneSpecSchema = z.object({
  slug,
  hearingRange: z.enum(['zone', 'location']).default('zone'),
});

export const LocationSpecSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(40),
  capacity: z.number().int().min(1).nullable().default(null),
  isPrivate: z.boolean().default(false),
  visualRef: z.string().min(1).nullable().default(null),
  zones: z.array(ZoneSpecSchema).default([]),
});

/** Route entre deux lieux désignés par leur slug. `bothWays` crée aussi la route retour. */
export const RouteSpecSchema = z.object({
  from: slug,
  to: slug,
  travelTicks: z.number().int().min(1).max(32),
  bothWays: z.boolean().default(false),
});

export const WorldConfigSpecSchema = z
  .object({
    ticksPerEpoch: z.number().int().min(1),
    tickMinutes: z.number().int().min(1),
    maxConversationTurns: z.number().int().min(1),
    maxInteractionsPerScene: z.number().int().min(1),
    startMs: z.number().int().min(0),
  })
  .partial();

export const SeasonRulesSpecSchema = z
  .object({
    economy: z
      .object({
        enabled: z.boolean(),
        startingCredits: z.number().int().min(0),
        dailyUpkeep: z.number().int().min(0),
        restrictedThreshold: z.number().int(),
        graceEpochs: z.number().int().min(0),
      })
      .partial(),
    relationshipAxes: z.array(z.string().min(1)),
    scoreWeights: z
      .object({
        social: z.number(),
        drama: z.number(),
        popularity: z.number(),
        survival: z.number(),
        influence: z.number(),
      })
      .partial(),
    enabledActions: z.array(z.string().min(1)),
  })
  .partial();

export const WorldSetupSchema = z
  .object({
    world: z.object({
      name: z.string().trim().min(1).max(120),
      seed: z.string().min(1).max(120),
      config: WorldConfigSpecSchema.default({}),
    }),
    season: z
      .object({
        number: z.number().int().min(1).default(1),
        rules: SeasonRulesSpecSchema.default({}),
        format: z.record(z.string(), z.unknown()).default({}),
      })
      .default({ number: 1, rules: {}, format: {} }),
    locations: z.array(LocationSpecSchema).min(1),
    routes: z.array(RouteSpecSchema).default([]),
  })
  .superRefine((setup, ctx) => {
    const slugs = new Set<string>();
    for (const [i, l] of setup.locations.entries()) {
      if (slugs.has(l.slug))
        ctx.addIssue({ code: 'custom', path: ['locations', i, 'slug'], message: 'slug en double' });
      slugs.add(l.slug);
    }
    for (const [i, r] of setup.routes.entries()) {
      for (const end of ['from', 'to'] as const) {
        if (!slugs.has(r[end])) {
          ctx.addIssue({ code: 'custom', path: ['routes', i, end], message: `lieu inconnu « ${r[end]} »` });
        }
      }
      if (r.from === r.to) ctx.addIssue({ code: 'custom', path: ['routes', i], message: 'route vers soi-même' });
    }
  });

export type WorldSetupInput = z.input<typeof WorldSetupSchema>;
export type WorldSetup = z.output<typeof WorldSetupSchema>;
