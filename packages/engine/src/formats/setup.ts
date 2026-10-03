/**
 * Mise en place d'une saison de format (game-formats.md §7) : définitions d'objets, équipes et composition, objets
 * déposés, définitions de missions et calendrier matérialisé en `scheduled_event`. Idempotent à l'échelle de la saison :
 * `needsSetup` dit s'il reste quelque chose à faire (un `FormatState` déjà garni n'est jamais retouché).
 */
import type { Rng } from '../core/rng.js';
import {
  formatOf,
  peekFormat,
  type ItemDefNode,
  type MissionDefNode,
  type MissionReward,
} from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import { expandSchedule } from './format-service.js';
import { placeItem } from './inventory.js';
import { emptyOutput, mergeOutput, type FormatContext, type FormatOutput } from './output.js';
import type { SeasonFormat } from './season-format.js';
import { createTeam, moveCharacter } from './teams.js';

/** Nombre d'époques sur lequel les périodicités (`every`) sont matérialisées quand la saison ne le précise pas. */
export const DEFAULT_SEASON_EPOCHS = 12;

export function needsSetup(state: Readonly<SimState>): boolean {
  const fs = peekFormat(state);
  return (
    Object.keys(fs.itemDefs).length === 0 &&
    Object.keys(fs.teams).length === 0 &&
    Object.keys(fs.scheduled).length === 0 &&
    Object.keys(fs.missionDefs).length === 0
  );
}

const locationBySlug = (state: Readonly<SimState>, slug: string): Id | null =>
  Object.values(state.locations).find((l) => l.slug === slug || l.id === slug)?.id ?? null;

function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Récompense sans clé indéfinie (propriétés optionnelles exactes). */
const rewardOf = (r: {
  credits?: number | undefined;
  stats?: Record<string, number> | undefined;
  scores?: Record<string, number> | undefined;
}): MissionReward => ({
  ...(r.credits !== undefined ? { credits: r.credits } : {}),
  ...(r.stats ? { stats: r.stats } : {}),
  ...(r.scores ? { scores: r.scores } : {}),
});

export interface SetupOptions {
  readonly epochs?: number;
}

export function setupFormat(
  state: SimState,
  fc: FormatContext,
  format: SeasonFormat,
  rng: Rng,
  options: SetupOptions = {},
): FormatOutput {
  const fs = formatOf(state);
  const out = emptyOutput();

  for (const spec of format.items) {
    const def: ItemDefNode = {
      id: fc.ids.next(),
      slug: spec.slug,
      name: spec.name ?? spec.slug,
      description: null,
      kind: spec.kind,
      effects: {
        ...spec.effects,
        ...(spec.expires === 'after_use' ? { expires: 'after_use' } : {}),
        ...(spec.points_to ? { points_to: spec.points_to } : {}),
      },
      transferable: spec.transferable,
      expiresAfterEpoch: typeof spec.expires === 'object' ? spec.expires.afterEpoch : null,
      visualRef: null,
    };
    fs.itemDefs[def.id] = def;
  }

  const teams = format.teams.map((spec) => {
    const created = createTeam(state, fc, {
      slug: spec.slug,
      name: spec.name ?? spec.slug,
      color: spec.color ?? null,
      campLocationId: spec.camp ? locationBySlug(state, spec.camp) : null,
    });
    mergeOutput(out, created);
    return created.team;
  });
  if (teams.length > 0) {
    const players = Object.values(state.characters)
      .filter((c) => c.status !== 'eliminated' && c.status !== 'paused')
      .map((c) => c.id)
      .sort();
    shuffled(players, rng).forEach((characterId, i) => {
      const team = teams[i % teams.length];
      if (team) mergeOutput(out, moveCharacter(state, fc, characterId, team.id));
    });
  }

  const spots = Object.values(state.locations)
    .filter((l) => !l.isPrivate)
    .map((l) => l.id)
    .sort();
  for (const spec of format.items) {
    if (spec.placement === 'challenge_reward' || spots.length === 0) continue;
    const def = Object.values(fs.itemDefs).find((d) => d.slug === spec.slug);
    if (!def) continue;
    const fixed = spec.location ? locationBySlug(state, spec.location) : null;
    for (let n = 0; n < spec.count; n += 1) {
      mergeOutput(
        out,
        placeItem(state, fc, {
          itemDefId: def.id,
          locationId: fixed ?? (spots[rng.int(spots.length)] as Id),
          hidden: spec.placement === 'hidden',
          ...(spec.difficulty !== undefined ? { difficulty: spec.difficulty } : {}),
        }),
      );
    }
  }

  for (const spec of format.missions) {
    const title = spec.title ?? spec.slug;
    const def: MissionDefNode = {
      id: fc.ids.next(),
      slug: spec.slug,
      title,
      briefing: spec.briefing ?? title,
      scope: spec.scope,
      secrecy: spec.secrecy,
      objective: spec.objective ?? { any: [] },
      failure: spec.failure ?? null,
      reward: rewardOf(spec.reward),
      penalty: spec.penalty ? rewardOf(spec.penalty) : null,
      deadlineEpochOffset: spec.deadlineEpochOffset ?? null,
    };
    fs.missionDefs[def.id] = def;
  }

  for (const node of expandSchedule(format, options.epochs ?? DEFAULT_SEASON_EPOCHS, fc.ids)) {
    const slug = node.params['location'];
    const locationId = typeof slug === 'string' ? locationBySlug(state, slug) : null;
    const slugs = node.participants['characterSlugs'];
    const participants = Array.isArray(slugs)
      ? {
          characterIds: Object.values(state.characters)
            .filter((c) => slugs.includes(c.slug))
            .map((c) => c.id)
            .sort(),
        }
      : node.participants;
    fs.scheduled[node.id] = { ...node, locationId, participants };
  }
  return out;
}
