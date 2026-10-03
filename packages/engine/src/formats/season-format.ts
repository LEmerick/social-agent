/**
 * Configuration de format d'une saison (`season.format`, game-formats.md §7) et préréglages `villa` / `adventure`.
 * Le moteur ne connaît aucun format en dur : tout passe par cette configuration validée.
 */
import { z } from 'zod';
import { DomainError } from '../core/errors.js';
import { ConditionSchema } from './conditions/schema.js';

const slug = z.string().min(1);
const params = z.record(z.string(), z.unknown());

export const ItemSpecSchema = z
  .object({
    slug,
    name: z.string().optional(),
    kind: z.enum(['power', 'resource', 'clue', 'cosmetic']),
    count: z.number().int().min(0).default(1),
    placement: z.enum(['hidden', 'visible', 'challenge_reward', 'held']).default('hidden'),
    difficulty: z.number().int().min(0).max(100).optional(),
    effects: z.record(z.string(), z.unknown()).default({}),
    expires: z.union([z.literal('after_use'), z.object({ afterEpoch: z.number().int().min(0) }).strict()]).optional(),
    points_to: slug.optional(),
    transferable: z.boolean().default(true),
  })
  .strict();

export const ScheduleSpecSchema = z
  .object({
    kind: z.enum([
      'challenge',
      'council',
      'meal',
      'announcement',
      'item_drop',
      'mission_assign',
      'team_shuffle',
      'merge',
      'final',
    ]),
    /** Périodicité en époques (1 = chaque époque) ; `from` : première époque concernée. */
    every: z.number().int().min(1).optional(),
    from: z.number().int().min(0).optional(),
    epoch: z.number().int().min(0).optional(),
    tick: z.number().int().min(0).optional(),
    tickEnd: z.number().int().min(0).optional(),
    trigger: ConditionSchema.optional(),
    params: params.default({}),
    participants: params.default({}),
    mandatory: z.boolean().default(true),
    announced: z.boolean().default(true),
  })
  .strict()
  .refine((s) => s.every !== undefined || s.epoch !== undefined || s.trigger !== undefined, {
    message: 'Un événement planifié a besoin de `every`, `epoch` ou `trigger`',
  });

export const MissionSpecSchema = z
  .object({
    slug,
    title: z.string().optional(),
    briefing: z.string().optional(),
    scope: z.enum(['individual', 'team', 'all']).default('individual'),
    secrecy: z.enum(['public', 'private', 'secret']).default('secret'),
    objective: ConditionSchema.optional(),
    failure: ConditionSchema.optional(),
    reward: z
      .object({
        credits: z.number().optional(),
        stats: z.record(z.string(), z.number()).optional(),
        scores: z.record(z.string(), z.number()).optional(),
      })
      .strict()
      .default({}),
    penalty: z
      .object({
        credits: z.number().optional(),
        stats: z.record(z.string(), z.number()).optional(),
        scores: z.record(z.string(), z.number()).optional(),
      })
      .strict()
      .optional(),
    deadlineEpochOffset: z.number().int().min(0).optional(),
    assign: z
      .object({ random: z.number().int().min(1).optional(), epoch: z.number().int().min(0).optional() })
      .strict()
      .optional(),
  })
  .strict();

export const VoteRulesSpecSchema = z
  .object({
    tie: z.enum(['revote', 'random', 'none']).default('revote'),
    maxRounds: z.number().int().min(1).default(2),
    allowSelfVote: z.boolean().default(false),
    revealVotes: z.boolean().default(false),
    immunityItems: z.boolean().default(true),
  })
  .strict();

export const SeasonFormatSchema = z
  .object({
    format: z.string().min(1),
    ticksPerEpoch: z.number().int().min(1).optional(),
    teams: z
      .array(
        z.object({ slug, name: z.string().optional(), color: z.string().optional(), camp: slug.optional() }).strict(),
      )
      .default([]),
    economy: z.object({ enabled: z.boolean() }).strict().default({ enabled: true }),
    survival: z
      .object({ eliminationBy: z.enum(['vote', 'public_vote', 'economy']) })
      .strict()
      .default({ eliminationBy: 'vote' }),
    relationshipAxes: z.array(z.string()).default([]),
    actions: z
      .object({ enable: z.array(z.string()) })
      .strict()
      .default({ enable: [] }),
    items: z.array(ItemSpecSchema).default([]),
    schedule: z.array(ScheduleSpecSchema).default([]),
    missions: z.array(MissionSpecSchema).default([]),
    vote: VoteRulesSpecSchema.default({
      tie: 'revote',
      maxRounds: 2,
      allowSelfVote: false,
      revealVotes: false,
      immunityItems: true,
    }),
  })
  .strict();

export type SeasonFormat = z.infer<typeof SeasonFormatSchema>;
export type SeasonFormatInput = z.input<typeof SeasonFormatSchema>;
export type ItemSpec = z.infer<typeof ItemSpecSchema>;
export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;
export type MissionSpec = z.infer<typeof MissionSpecSchema>;

/** Format « Aventure » (game-formats.md §7). */
export const ADVENTURE_FORMAT: SeasonFormatInput = {
  format: 'adventure',
  ticksPerEpoch: 32,
  teams: [
    { slug: 'red', camp: 'camp_north' },
    { slug: 'yellow', camp: 'camp_south' },
  ],
  economy: { enabled: false },
  survival: { eliminationBy: 'vote' },
  relationshipAxes: ['teammate_bond'],
  actions: {
    enable: [
      'search',
      'pick_up',
      'give',
      'steal',
      'hide',
      'use_item',
      'show_item',
      'fake_item',
      'cast_vote',
      'spy_camp',
    ],
  },
  items: [
    {
      slug: 'immunity_necklace',
      kind: 'power',
      count: 1,
      placement: 'hidden',
      difficulty: 75,
      effects: { on: 'vote_session', nullify_votes_against_holder: true },
      expires: 'after_use',
    },
    { slug: 'clue', kind: 'clue', count: 3, placement: 'hidden', difficulty: 40, points_to: 'immunity_necklace' },
    { slug: 'food_ration', kind: 'resource', count: 20, placement: 'challenge_reward' },
  ],
  schedule: [
    { kind: 'challenge', every: 1, tick: 12, params: { type: 'endurance', reward: 'immunity_team' } },
    { kind: 'council', every: 1, tick: 28, participants: { losing_team: true } },
    { kind: 'merge', trigger: { count_active: { lte: 10 } } },
    {
      kind: 'item_drop',
      trigger: { not: { holds: { who: '?', item: 'immunity_necklace' } }, epoch_gte: 6 },
      params: { item: 'clue' },
    },
    { kind: 'final', trigger: { count_active: { lte: 3 } } },
  ],
  missions: [{ slug: 'find_necklace_holder', assign: { random: 2, epoch: 3 } }],
};

/** Format « Villa » : pas d'équipes, économie de crédits, vote du public, missions secrètes, pas d'objets cachés. */
export const VILLA_FORMAT: SeasonFormatInput = {
  format: 'villa',
  economy: { enabled: true },
  survival: { eliminationBy: 'public_vote' },
  relationshipAxes: [],
  actions: { enable: ['cast_vote', 'use_item', 'show_item'] },
  items: [],
  schedule: [
    { kind: 'meal', every: 1, tick: 14 },
    { kind: 'council', every: 7, from: 6, tick: 28, params: { vote: 'public' } },
  ],
  missions: [],
  vote: { tie: 'random', maxRounds: 1, allowSelfVote: false, revealVotes: false, immunityItems: true },
};

export const FORMAT_PRESETS: Readonly<Record<string, SeasonFormatInput>> = {
  villa: VILLA_FORMAT,
  adventure: ADVENTURE_FORMAT,
};

/**
 * Valide la configuration d'une saison. Un champ `format` nommant un préréglage (`villa`, `adventure`) complète
 * les clés absentes ; une clé fournie remplace celle du préréglage. Un format vide vaut `villa`.
 */
export function parseSeasonFormat(raw: Readonly<Record<string, unknown>>): SeasonFormat {
  const name = typeof raw['format'] === 'string' ? raw['format'] : 'villa';
  const preset = FORMAT_PRESETS[name];
  const parsed = SeasonFormatSchema.safeParse({ ...preset, ...raw, format: name });
  if (!parsed.success) {
    throw new DomainError('INVALID_FORMAT', `Format de saison invalide : ${parsed.error.message}`);
  }
  return parsed.data;
}
