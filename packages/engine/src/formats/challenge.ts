/**
 * Épreuve collective (game-formats.md §4) : la performance d'une équipe agrège les traits et l'énergie de ses membres,
 * plus un tirage (déterministe). Sans équipes, chaque participant est sa propre unité. Récompense : immunité d'équipe,
 * objet, crédits, plus les objets `challenge_reward` du format.
 */
import { NEUTRAL_TRAIT } from '../character/compile.js';
import type { TickContext } from '../epoch/types.js';
import { formatOf, teamOf, type ScheduledEventNode } from '../state/format-state.js';
import type { Id } from '../state/types.js';
import { applyLogged, countOfDef, grantItem } from './ceremony-kit.js';
import { formatContextOf } from './hook-kit.js';
import { emitEffect, emitEvent, emptyOutput, mergeOutput, type FormatOutput } from './output.js';
import type { SeasonFormat } from './season-format.js';

/** Traits qui comptent selon le type d'épreuve. */
export const CHALLENGE_TRAITS: Readonly<Record<string, readonly string[]>> = {
  endurance: ['competitiveness', 'loyalty'],
  strength: ['competitiveness', 'ambition'],
  skill: ['ambition', 'manipulation'],
  puzzle: ['manipulation', 'empathy'],
};
const DEFAULT_TRAITS: readonly string[] = ['competitiveness'];

export const ENERGY_COST = 15;

export interface ChallengeResult {
  readonly type: string;
  readonly units: readonly {
    readonly key: string;
    readonly teamId: Id | null;
    readonly members: Id[];
    readonly score: number;
  }[];
  readonly winnerKey: string;
  readonly winnerTeamId: Id | null;
  readonly loserTeamIds: Id[];
  readonly winners: Id[];
  readonly losers: Id[];
}

/** Performance d'un personnage : traits (50 %), énergie (35 %), tirage (15 %), de 0 à 1. */
export function performanceOf(ctx: TickContext, characterId: Id, type: string): number {
  const c = ctx.state.characters[characterId];
  if (!c) return 0;
  const keys = CHALLENGE_TRAITS[type] ?? DEFAULT_TRAITS;
  const trait = keys.reduce((sum, k) => sum + (c.traits[k] ?? NEUTRAL_TRAIT), 0) / keys.length / 100;
  return 0.5 * trait + 0.35 * (c.stats.energy / 100) + 0.15 * ctx.rng('challenge', characterId).next();
}

export function scoreChallenge(ctx: TickContext, s: ScheduledEventNode, participants: readonly Id[]): ChallengeResult {
  const fs = formatOf(ctx.state);
  const type = typeof s.params['type'] === 'string' ? s.params['type'] : 'endurance';
  const groups = new Map<string, { teamId: Id | null; members: Id[] }>();
  // Une seule équipe en lice (après la fusion) : chacun concourt pour soi.
  const teams = new Set(participants.map((id) => teamOf(fs, id, ctx.epochNumber)).filter((t) => t !== null));
  for (const id of participants) {
    const teamId = teams.size >= 2 ? teamOf(fs, id, ctx.epochNumber) : null;
    const key = teamId ?? id;
    const group = groups.get(key) ?? { teamId, members: [] };
    group.members.push(id);
    groups.set(key, group);
  }
  const units = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      teamId: g.teamId,
      members: g.members.sort(),
      score: g.members.reduce((sum, m) => sum + performanceOf(ctx, m, type), 0) / g.members.length,
    }))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const winner = units[0];
  const winners = winner ? winner.members : [];
  const rest = units.slice(1);
  return {
    type,
    units,
    winnerKey: winner?.key ?? '',
    winnerTeamId: winner?.teamId ?? null,
    loserTeamIds: rest.flatMap((u) => (u.teamId ? [u.teamId] : [])),
    winners,
    losers: rest.flatMap((u) => u.members).sort(),
  };
}

/** Résout l'épreuve, applique les effets et la récompense, et consigne le résultat dans `params.result`. */
export function runChallenge(
  ctx: TickContext,
  format: SeasonFormat,
  s: ScheduledEventNode,
  participants: readonly Id[],
  causedByEventId: Id,
): FormatOutput {
  const out = emptyOutput();
  if (participants.length === 0) return out;
  const fc = formatContextOf(ctx);
  const result = scoreChallenge(ctx, s, participants);
  const reward = typeof s.params['reward'] === 'string' ? s.params['reward'] : null;
  const event = emitEvent(ctx.state, fc, out, {
    type: 'team_challenge_resolved',
    importance: 0.6,
    locationId: s.locationId,
    payload: {
      scheduledEventId: s.id,
      type: result.type,
      winnerKey: result.winnerKey,
      winnerTeamId: result.winnerTeamId,
      scores: result.units.map((u) => ({ key: u.key, score: Math.round(u.score * 1000) / 1000 })),
      reward,
    },
    causedByEventId,
    participants: [
      ...result.winners.map((characterId) => ({ characterId, role: 'actor' as const })),
      ...result.losers.map((characterId) => ({ characterId, role: 'target' as const })),
    ],
  });
  for (const id of participants) {
    applyLogged(ctx, fc, out, event.id, id, 'stat', 'energy', -ENERGY_COST);
    applyLogged(ctx, fc, out, event.id, id, 'stat', 'morale', result.winners.includes(id) ? 5 : -3);
  }

  const resultNode: Record<string, unknown> = {
    winnerTeamId: result.winnerTeamId,
    loserTeamId: result.loserTeamIds[0] ?? null,
    loserTeamIds: result.loserTeamIds,
    winners: result.winners,
  };
  if (reward === 'immunity_team' && result.winners.length > 0) {
    const granted = emitEvent(ctx.state, fc, out, {
      type: 'immunity_granted',
      importance: 0.5,
      payload: { teamId: result.winnerTeamId, characterIds: result.winners },
      causedByEventId: event.id,
      participants: result.winners.map((characterId) => ({ characterId, role: 'subject' as const })),
    });
    for (const characterId of result.winners) {
      emitEffect(fc, out, granted.id, {
        targetKind: 'team',
        characterId,
        dimension: 'immunity',
        ruleId: 'ceremony',
        reason: result.winnerTeamId,
      });
    }
    resultNode['immuneIds'] = result.winners;
  } else if (reward?.startsWith('credits:')) {
    const amount = Number(reward.slice('credits:'.length));
    if (Number.isFinite(amount)) {
      for (const id of result.winners) applyLogged(ctx, fc, out, event.id, id, 'credit', 'credits', amount);
    }
  } else if (reward?.startsWith('item:')) {
    const slug = reward.slice('item:'.length);
    const def = Object.values(formatOf(ctx.state).itemDefs).find((d) => d.slug === slug);
    if (def) for (const id of result.winners) mergeOutput(out, grantItem(ctx, def, id, event.id));
  }

  // Rations et autres objets `challenge_reward` du format : un exemplaire par vainqueur tant que le stock le permet.
  for (const spec of format.items.filter((i) => i.placement === 'challenge_reward')) {
    const def = Object.values(formatOf(ctx.state).itemDefs).find((d) => d.slug === spec.slug);
    if (!def) continue;
    for (const id of result.winners) {
      if (countOfDef(ctx, def.id) >= spec.count) break;
      mergeOutput(out, grantItem(ctx, def, id, event.id));
    }
  }
  (s.params as Record<string, unknown>)['result'] = resultNode;
  return out;
}
