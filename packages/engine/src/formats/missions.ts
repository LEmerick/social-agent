/**
 * MissionService pur (game-formats.md §3). Une mission est attribuée à un personnage ou à une équipe ; son objectif
 * et son échec sont des conditions du DSL évaluées par le moteur après chaque event. Une mission `secret` n'est
 * connue que de son titulaire (le briefing est un fait `mission` appris par lui seul).
 */
import { DomainError } from '../core/errors.js';
import { applyEffect } from '../state/apply-effect.js';
import {
  formatOf,
  isMemberAt,
  peekFormat,
  type MissionAssignmentNode,
  type MissionDefNode,
  type MissionReward,
  type MissionStatus,
} from '../state/format-state.js';
import type { EventRecord } from '../state/journal.js';
import type { Goal, Id, SimState } from '../state/types.js';
import { witness } from '../knowledge/transmit.js';
import { createFact } from '../knowledge/facts.js';
import { evaluate, type Bindings } from './conditions/evaluate.js';
import { emitEffect, emitEvent, emptyOutput, type FormatContext, type FormatOutput } from './output.js';

const RULE = 'mission';

export interface MissionResolution {
  readonly assignmentId: Id;
  readonly status: Exclude<MissionStatus, 'active' | 'abandoned'>;
}

/** Titulaires d'une attribution à l'époque donnée. */
export function holdersOf(
  state: Readonly<SimState>,
  a: Pick<MissionAssignmentNode, 'characterId' | 'teamId'>,
  epoch: number,
): Id[] {
  if (a.characterId) return [a.characterId];
  return peekFormat(state)
    .memberships.filter((m) => m.teamId === a.teamId && isMemberAt(m, epoch))
    .map((m) => m.characterId)
    .sort();
}

function bindingsFor(state: Readonly<SimState>, a: MissionAssignmentNode, epoch: number): Bindings {
  const holders = holdersOf(state, a, epoch);
  return {
    ...(a.characterId ? { self: a.characterId } : holders[0] ? { self: holders[0] } : {}),
    ...(a.teamId ? { team: a.teamId } : {}),
    ...(a.deadlineEpoch !== null ? { deadline: a.deadlineEpoch } : {}),
    epoch,
  };
}

/**
 * Évalue les missions actives sans rien modifier : réussite (objectif), puis échec (condition `failure`),
 * puis expiration (échéance dépassée). Les conditions lisent l'état déjà à jour après l'event déclencheur
 * (`resolveMissions` relie la résolution à cet event).
 */
export function evaluateMissions(state: Readonly<SimState>): MissionResolution[] {
  const fs = peekFormat(state);
  const epoch = state.epoch?.number ?? 0;
  const resolutions: MissionResolution[] = [];
  for (const a of Object.values(fs.assignments).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (a.status !== 'active') continue;
    const def = fs.missionDefs[a.missionDefId];
    if (!def) continue;
    const b = bindingsFor(state, a, epoch);
    if (evaluate(def.objective, state, b)) resolutions.push({ assignmentId: a.id, status: 'succeeded' });
    else if (def.failure && evaluate(def.failure, state, b)) resolutions.push({ assignmentId: a.id, status: 'failed' });
    else if (a.deadlineEpoch !== null && epoch > a.deadlineEpoch) {
      resolutions.push({ assignmentId: a.id, status: 'expired' });
    }
  }
  return resolutions;
}

function applyReward(
  state: SimState,
  fc: FormatContext,
  out: FormatOutput,
  eventId: Id,
  characterId: Id,
  reward: MissionReward,
  sign: 1 | -1,
): void {
  const apply = (targetKind: 'credit' | 'stat' | 'score', dimension: string, amount: number): void => {
    const delta = sign * amount;
    const valueAfter = applyEffect(state, {
      targetKind,
      characterId,
      otherCharacterId: null,
      dimension,
      delta,
      ruleId: RULE,
      ruleVersion: 1,
      reason: null,
    });
    emitEffect(fc, out, eventId, { targetKind, characterId, dimension, delta, ruleId: RULE, valueAfter });
  };
  if (reward.credits) apply('credit', 'credits', reward.credits);
  for (const [k, v] of Object.entries(reward.stats ?? {})) apply('stat', k, v);
  for (const [k, v] of Object.entries(reward.scores ?? {})) apply('score', k, v);
}

/**
 * Applique les résolutions : statut, événement `mission_succeeded` / `mission_failed` et effets de récompense
 * (réussite) ou de pénalité (échec ou expiration). Une mission d'équipe applique les effets à chaque membre.
 */
export function resolveMissions(
  state: SimState,
  fc: FormatContext,
  afterEvent: EventRecord | null = null,
): FormatOutput & { readonly resolutions: MissionResolution[] } {
  const fs = formatOf(state);
  const out = emptyOutput();
  const resolutions = evaluateMissions(state);
  for (const r of resolutions) {
    const a = fs.assignments[r.assignmentId] as MissionAssignmentNode;
    const def = fs.missionDefs[a.missionDefId] as MissionDefNode;
    const holders = holdersOf(state, a, fc.epoch);
    const event = emitEvent(state, fc, out, {
      type: r.status === 'succeeded' ? 'mission_succeeded' : 'mission_failed',
      importance: 0.6,
      payload: { assignmentId: a.id, missionDefId: def.id, slug: def.slug, status: r.status, secrecy: def.secrecy },
      causedByEventId: afterEvent?.id ?? null,
      participants: holders.map((characterId) => ({ characterId, role: 'subject' as const })),
    });
    a.status = r.status;
    a.resolvedEventId = event.id;
    const consequence = r.status === 'succeeded' ? def.reward : def.penalty;
    for (const holder of holders) {
      emitEffect(fc, out, event.id, {
        targetKind: 'mission',
        characterId: holder,
        dimension: 'status',
        ruleId: RULE,
        reason: a.id,
      });
      if (consequence) applyReward(state, fc, out, event.id, holder, consequence, r.status === 'succeeded' ? 1 : -1);
      const goals = state.characters[holder]?.goals ?? [];
      const at = goals.findIndex((g) => g.id === a.id);
      const goal = goals[at];
      if (goal) goals[at] = { ...goal, status: r.status === 'succeeded' ? 'achieved' : 'abandoned' };
    }
  }
  return { ...out, resolutions };
}

export type MissionTarget = { readonly characterId: Id } | { readonly teamId: Id };

export interface AssignInput {
  readonly missionDefId: Id;
  readonly to: MissionTarget;
  readonly assignmentId?: Id;
  readonly causedByEventId?: Id | null;
}

/**
 * Attribue une mission : crée l'attribution (échéance = époque + `deadlineEpochOffset`), l'événement
 * `mission_assigned`, un objectif de saison (`origin = 'season'`) et le briefing comme connaissance
 * (titulaire seul si `secret` ou `private` ; toute l'équipe pour une équipe ; tout le monde si `public`).
 */
export function assignMission(
  state: SimState,
  fc: FormatContext,
  input: AssignInput,
): FormatOutput & { readonly assignment: MissionAssignmentNode } {
  const fs = formatOf(state);
  const def = fs.missionDefs[input.missionDefId];
  if (!def) throw new DomainError('NOT_FOUND', `Mission ${input.missionDefId} inconnue`);
  const characterId = 'characterId' in input.to ? input.to.characterId : null;
  const teamId = 'teamId' in input.to ? input.to.teamId : null;
  if (characterId && !state.characters[characterId]) {
    throw new DomainError('NOT_FOUND', `Personnage ${characterId} absent du SimState`);
  }
  if (teamId && !fs.teams[teamId]) throw new DomainError('NOT_FOUND', `Équipe ${teamId} inconnue`);
  const out = emptyOutput();
  const holders = holdersOf(state, { characterId, teamId }, fc.epoch);
  const assignmentId = input.assignmentId ?? fc.ids.next();
  if (fs.assignments[assignmentId]) throw new DomainError('DUPLICATE', `Attribution ${assignmentId} déjà présente`);
  const deadlineEpoch = def.deadlineEpochOffset === null ? null : fc.epoch + def.deadlineEpochOffset;
  const event = emitEvent(state, fc, out, {
    type: 'mission_assigned',
    importance: 0.4,
    payload: { assignmentId, missionDefId: def.id, slug: def.slug, secrecy: def.secrecy, deadlineEpoch },
    causedByEventId: input.causedByEventId ?? null,
    participants: holders.map((id) => ({ characterId: id, role: 'subject' as const })),
  });
  const eventId = event.id;
  const assignment: MissionAssignmentNode = {
    id: assignmentId,
    missionDefId: def.id,
    characterId,
    teamId,
    assignedEventId: eventId,
    deadlineEpoch,
    status: 'active',
    progress: {},
    resolvedEventId: null,
  };
  fs.assignments[assignment.id] = assignment;

  for (const holder of holders) {
    emitEffect(fc, out, eventId, {
      targetKind: 'mission',
      characterId: holder,
      dimension: 'status',
      ruleId: RULE,
      reason: assignment.id,
    });
    const goal: Goal = {
      id: assignment.id,
      kind: 'secondary',
      description: def.briefing,
      origin: 'season',
      targetCharacterId: null,
      status: 'open',
    };
    state.characters[holder]?.goals.push(goal);
    out.goals.push({ characterId: holder, goal });
  }

  const fact = createFact(
    state,
    {
      subjectId: characterId,
      predicate: 'mission',
      objectText: `mission:${assignment.id}`,
      sensitivity: def.secrecy === 'public' ? 0 : 3,
      originEventId: eventId,
    },
    fc.ids,
  );
  out.facts.push(fact);
  const audience =
    def.secrecy === 'public'
      ? Object.values(state.characters)
          .filter((c) => c.status !== 'eliminated')
          .map((c) => c.id)
      : holders;
  const learned = witness(
    state,
    {
      factIds: [fact.id],
      witnesses: audience.sort().map((id) => ({ characterId: id, perception: 'hears' as const })),
      viaEventId: eventId,
      epoch: fc.epoch,
      tick: fc.tick,
    },
    fc.ids,
  );
  out.knowledge.push(...learned.knowledge);
  return { ...out, assignment };
}

/** Missions actives d'un personnage (les siennes et celles de son équipe). */
export function activeMissions(state: Readonly<SimState>, characterId: Id): MissionAssignmentNode[] {
  const fs = peekFormat(state);
  const epoch = state.epoch?.number ?? 0;
  return Object.values(fs.assignments)
    .filter((a) => a.status === 'active' && holdersOf(state, a, epoch).includes(characterId))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
}
