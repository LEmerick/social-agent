/**
 * TeamService pur (game-formats.md §4). L'appartenance est une projection datée : `fromEpoch`/`toEpoch` bornent
 * une adhésion, on n'efface jamais l'historique. Une équipe dissoute garde ses adhésions closes.
 */
import { DomainError } from '../core/errors.js';
import { formatOf, membersOf, teamOf, type TeamMembershipNode, type TeamNode } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';
import { emitEffect, emitEvent, emptyOutput, type FormatContext, type FormatOutput } from './output.js';

const RULE = 'team';

export interface TeamInput {
  readonly slug: string;
  readonly name: string;
  readonly color?: string | null;
  readonly campLocationId?: Id | null;
  readonly teamId?: Id;
}

export function createTeam(
  state: SimState,
  fc: FormatContext,
  input: TeamInput,
): FormatOutput & { readonly team: TeamNode } {
  const fs = formatOf(state);
  if (Object.values(fs.teams).some((t) => t.slug === input.slug && t.dissolvedEpoch === null)) {
    throw new DomainError('DUPLICATE', `Équipe « ${input.slug} » déjà présente`);
  }
  if (input.campLocationId && !state.locations[input.campLocationId]) {
    throw new DomainError('NOT_FOUND', `Lieu ${input.campLocationId} absent du SimState`);
  }
  const team: TeamNode = {
    id: input.teamId ?? fc.ids.next(),
    slug: input.slug,
    name: input.name,
    color: input.color ?? null,
    campLocationId: input.campLocationId ?? null,
    createdEpoch: fc.epoch,
    dissolvedEpoch: null,
  };
  if (fs.teams[team.id]) throw new DomainError('DUPLICATE', `Équipe ${team.id} déjà présente`);
  fs.teams[team.id] = team;
  const out = emptyOutput();
  emitEvent(state, fc, out, {
    type: 'team_created',
    locationId: team.campLocationId,
    payload: { teamId: team.id, slug: team.slug, name: team.name },
  });
  return { ...out, team };
}

function join(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  characterId: Id,
  toTeamId: Id | null,
  causedBy: Id | null,
): void {
  const fs = formatOf(state);
  const from = teamOf(fs, characterId, fc.epoch);
  const current = fs.memberships.find((m) => m.characterId === characterId && m.toEpoch === null);
  if (from === toTeamId) return;
  if (current) current.toEpoch = fc.epoch - 1;
  const event = emitEvent(state, fc, out, {
    type: 'team_member_moved',
    importance: 0.4,
    payload: { characterId, fromTeamId: from, toTeamId },
    causedByEventId: causedBy,
    participants: [{ characterId, role: 'subject' }],
  });
  emitEffect(fc, out, event.id, {
    targetKind: 'team',
    characterId,
    dimension: 'membership',
    ruleId: RULE,
    reason: toTeamId,
  });
  if (toTeamId !== null) {
    const membership: TeamMembershipNode = {
      teamId: toTeamId,
      characterId,
      fromEpoch: fc.epoch,
      toEpoch: null,
      joinedEventId: event.id,
    };
    fs.memberships.push(membership);
  }
}

/** Place un personnage dans une équipe (ou hors de toute équipe si `toTeamId` est nul) à l'époque courante. */
export function moveCharacter(state: SimState, fc: FormatContext, characterId: Id, toTeamId: Id | null): FormatOutput {
  if (!state.characters[characterId])
    throw new DomainError('NOT_FOUND', `Personnage ${characterId} absent du SimState`);
  const fs = formatOf(state);
  if (toTeamId !== null) {
    const team = fs.teams[toTeamId];
    if (!team) throw new DomainError('NOT_FOUND', `Équipe ${toTeamId} inconnue`);
    if (team.dissolvedEpoch !== null) throw new DomainError('TEAM_DISSOLVED', `Équipe ${team.slug} dissoute`);
  }
  const out = emptyOutput();
  join(state, fc, out, characterId, toTeamId, null);
  return out;
}

/**
 * Fusionne des équipes dans une nouvelle : tous les membres de l'époque courante la rejoignent, les anciennes
 * équipes sont dissoutes (`dissolvedEpoch` = époque courante). Atomique : les équipes sont validées d'abord.
 */
export function mergeTeams(
  state: SimState,
  fc: FormatContext,
  teamIds: readonly Id[],
  into: Omit<TeamInput, 'teamId'> & { readonly teamId?: Id },
): FormatOutput & { readonly team: TeamNode; readonly moved: Id[] } {
  const fs = formatOf(state);
  const sources = [...new Set(teamIds)].map((id) => {
    const team = fs.teams[id];
    if (!team) throw new DomainError('NOT_FOUND', `Équipe ${id} inconnue`);
    if (team.dissolvedEpoch !== null) throw new DomainError('TEAM_DISSOLVED', `Équipe ${team.slug} dissoute`);
    return team;
  });
  if (sources.length < 2) throw new DomainError('INVALID_MERGE', 'Une fusion demande au moins deux équipes');
  const members = sources.flatMap((t) => membersOf(fs, t.id, fc.epoch)).sort();
  const created = createTeam(state, fc, into);
  const out = emptyOutput();
  out.events.push(...created.events);
  const mergeEvent = emitEvent(state, fc, out, {
    type: 'team_merged',
    importance: 0.7,
    payload: { from: sources.map((t) => t.id), into: created.team.id, members },
    causedByEventId: created.events[0]?.id ?? null,
  });
  for (const characterId of members) join(state, fc, out, characterId, created.team.id, mergeEvent.id);
  for (const t of sources) t.dissolvedEpoch = fc.epoch;
  return { ...out, team: created.team, moved: members };
}
