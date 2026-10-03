import type {
  FormatRuntime,
  ItemDefNode,
  ItemNode,
  MissionAssignmentNode,
  MissionDefNode,
  ScheduledEventNode,
  StorageTx,
  TeamMembershipNode,
  TeamNode,
  VoteNode,
  VoteSessionNode,
} from '@ai-reality/engine';
import { DomainError } from '@ai-reality/engine';
import { type Db, cmp, copy, duplicate, later, require_ } from './db.js';

/** Tables des formats de jeu : une Map par table, clés primaires comme en base. */
export interface FormatTables {
  itemDefs: Map<string, { seasonId: string; def: ItemDefNode }>;
  items: Map<string, ItemNode>;
  missionDefs: Map<string, { seasonId: string; def: MissionDefNode }>;
  assignments: Map<string, MissionAssignmentNode>;
  teams: Map<string, { seasonId: string; team: TeamNode }>;
  /** Clé : `teamId|characterId|fromEpoch`. */
  memberships: Map<string, TeamMembershipNode>;
  voteSessions: Map<string, VoteSessionNode>;
  /** Clé : `sessionId|voterId`. */
  votes: Map<string, VoteNode>;
  scheduled: Map<string, { seasonId: string; event: ScheduledEventNode }>;
  /** Clé : seasonId. */
  runtime: Map<string, FormatRuntime>;
}

export const emptyFormatTables = (): FormatTables => ({
  itemDefs: new Map(),
  items: new Map(),
  missionDefs: new Map(),
  assignments: new Map(),
  teams: new Map(),
  memberships: new Map(),
  voteSessions: new Map(),
  votes: new Map(),
  scheduled: new Map(),
  runtime: new Map(),
});

type FormatRepos = Pick<StorageTx, 'items' | 'missions' | 'teams' | 'votes' | 'schedule' | 'formatRuntime'>;

const byId = <T extends { id: string }>(a: T, b: T): number => cmp(a.id, b.id);

/** Dépôts des formats : mêmes références, unicités et ordres que `storage-prisma`. */
export function formatRepos(db: Db): FormatRepos {
  const t = db.formats;
  const seasonOfItemDef = (id: string): string | undefined => t.itemDefs.get(id)?.seasonId;
  const seasonOfMissionDef = (id: string): string | undefined => t.missionDefs.get(id)?.seasonId;
  const seasonOfTeam = (id: string): string | undefined => t.teams.get(id)?.seasonId;
  const seasonOfEpoch = (id: string): string | undefined => db.epochs.get(id)?.seasonId;
  const hasEvent = (id: string | null): boolean => id === null || db.events.has(id);

  return {
    items: {
      upsertDefs: (seasonId, defs) =>
        later(() => {
          require_(db.seasons.has(seasonId), `Saison ${seasonId}`);
          for (const def of defs) {
            const clash = [...t.itemDefs.values()].some(
              (d) => d.seasonId === seasonId && d.def.slug === def.slug && d.def.id !== def.id,
            );
            if (clash) throw duplicate(`Objet « ${def.slug} »`);
            t.itemDefs.set(def.id, { seasonId, def: copy(def) });
          }
        }),
      listDefs: (seasonId) =>
        later(() =>
          [...t.itemDefs.values()]
            .filter((d) => d.seasonId === seasonId)
            .map((d) => copy(d.def))
            .sort(byId),
        ),
      upsertItems: (items) =>
        later(() => {
          for (const item of items) {
            require_(t.itemDefs.has(item.itemDefId), `Définition d'objet ${item.itemDefId}`);
            if (item.fakeOfItemDefId)
              require_(t.itemDefs.has(item.fakeOfItemDefId), `Définition ${item.fakeOfItemDefId}`);
            if (item.holderId) require_(db.characters.has(item.holderId), `Personnage ${item.holderId}`);
            if (item.locationId) require_(db.locations.has(item.locationId), `Lieu ${item.locationId}`);
            if (item.holderId && item.locationId) {
              throw new DomainError('INVALID_ITEM', 'Un objet a au plus un emplacement : porteur OU lieu');
            }
            if (item.searchDifficulty !== null && (item.searchDifficulty < 0 || item.searchDifficulty > 100)) {
              throw new DomainError('INVALID_ITEM', 'Difficulté de fouille hors 0..100');
            }
            t.items.set(item.id, copy(item));
          }
        }),
      listItems: (seasonId) =>
        later(() =>
          [...t.items.values()]
            .filter((i) => seasonOfItemDef(i.itemDefId) === seasonId)
            .map((i) => copy(i))
            .sort(byId),
        ),
    },

    missions: {
      upsertDefs: (seasonId, defs) =>
        later(() => {
          require_(db.seasons.has(seasonId), `Saison ${seasonId}`);
          for (const def of defs) {
            const clash = [...t.missionDefs.values()].some(
              (d) => d.seasonId === seasonId && d.def.slug === def.slug && d.def.id !== def.id,
            );
            if (clash) throw duplicate(`Mission « ${def.slug} »`);
            t.missionDefs.set(def.id, { seasonId, def: copy(def) });
          }
        }),
      listDefs: (seasonId) =>
        later(() =>
          [...t.missionDefs.values()]
            .filter((d) => d.seasonId === seasonId)
            .map((d) => copy(d.def))
            .sort(byId),
        ),
      upsertAssignments: (assignments) =>
        later(() => {
          for (const a of assignments) {
            require_(t.missionDefs.has(a.missionDefId), `Mission ${a.missionDefId}`);
            if (a.characterId) require_(db.characters.has(a.characterId), `Personnage ${a.characterId}`);
            if (a.teamId) require_(t.teams.has(a.teamId), `Équipe ${a.teamId}`);
            require_(hasEvent(a.assignedEventId), `Événement ${a.assignedEventId}`);
            require_(hasEvent(a.resolvedEventId), `Événement ${String(a.resolvedEventId)}`);
            if ((a.characterId === null) === (a.teamId === null)) {
              throw new DomainError(
                'INVALID_MISSION',
                'Une mission est attribuée à exactement un personnage ou une équipe',
              );
            }
            t.assignments.set(a.id, copy(a));
          }
        }),
      listAssignments: (seasonId) =>
        later(() =>
          [...t.assignments.values()]
            .filter((a) => seasonOfMissionDef(a.missionDefId) === seasonId)
            .map((a) => copy(a))
            .sort(byId),
        ),
    },

    teams: {
      upsertTeams: (seasonId, teams) =>
        later(() => {
          require_(db.seasons.has(seasonId), `Saison ${seasonId}`);
          for (const team of teams) {
            if (team.campLocationId) require_(db.locations.has(team.campLocationId), `Lieu ${team.campLocationId}`);
            const clash = [...t.teams.values()].some(
              (d) => d.seasonId === seasonId && d.team.slug === team.slug && d.team.id !== team.id,
            );
            if (clash) throw duplicate(`Équipe « ${team.slug} »`);
            t.teams.set(team.id, { seasonId, team: copy(team) });
          }
        }),
      listTeams: (seasonId) =>
        later(() =>
          [...t.teams.values()]
            .filter((d) => d.seasonId === seasonId)
            .map((d) => copy(d.team))
            .sort(byId),
        ),
      upsertMemberships: (memberships) =>
        later(() => {
          for (const m of memberships) {
            require_(t.teams.has(m.teamId), `Équipe ${m.teamId}`);
            require_(db.characters.has(m.characterId), `Personnage ${m.characterId}`);
            require_(hasEvent(m.joinedEventId), `Événement ${String(m.joinedEventId)}`);
            t.memberships.set(`${m.teamId}|${m.characterId}|${String(m.fromEpoch)}`, copy(m));
          }
        }),
      listMemberships: (seasonId) =>
        later(() =>
          [...t.memberships.values()]
            .filter((m) => seasonOfTeam(m.teamId) === seasonId)
            .map((m) => copy(m))
            .sort((a, b) => cmp(a.teamId, b.teamId) || cmp(a.characterId, b.characterId) || a.fromEpoch - b.fromEpoch),
        ),
    },

    votes: {
      upsertSessions: (sessions) =>
        later(() => {
          for (const s of sessions) {
            require_(db.epochs.has(s.epochId), `Époque ${s.epochId}`);
            if (s.sceneId) require_(db.scenes.has(s.sceneId), `Scène ${s.sceneId}`);
            require_(hasEvent(s.eventId), `Événement ${String(s.eventId)}`);
            if (s.eventId && [...t.voteSessions.values()].some((o) => o.eventId === s.eventId && o.id !== s.id)) {
              throw duplicate(`Événement ${s.eventId}`);
            }
            t.voteSessions.set(s.id, copy(s));
          }
        }),
      listSessions: (seasonId) =>
        later(() =>
          [...t.voteSessions.values()]
            .filter((s) => seasonOfEpoch(s.epochId) === seasonId)
            .map((s) => copy(s))
            .sort(byId),
        ),
      upsertVotes: (votes) =>
        later(() => {
          for (const v of votes) {
            require_(t.voteSessions.has(v.voteSessionId), `Session de vote ${v.voteSessionId}`);
            require_(db.characters.has(v.voterId), `Personnage ${v.voterId}`);
            require_(db.characters.has(v.targetId), `Personnage ${v.targetId}`);
            t.votes.set(`${v.voteSessionId}|${v.voterId}`, copy(v));
          }
        }),
      listVotes: (seasonId) =>
        later(() =>
          [...t.votes.values()]
            .filter((v) => {
              const session = t.voteSessions.get(v.voteSessionId);
              return session !== undefined && seasonOfEpoch(session.epochId) === seasonId;
            })
            .map((v) => copy(v))
            .sort((a, b) => cmp(a.voteSessionId, b.voteSessionId) || cmp(a.voterId, b.voterId)),
        ),
    },

    schedule: {
      upsert: (seasonId, events) =>
        later(() => {
          require_(db.seasons.has(seasonId), `Saison ${seasonId}`);
          for (const event of events) {
            if (event.locationId) require_(db.locations.has(event.locationId), `Lieu ${event.locationId}`);
            require_(hasEvent(event.firedEventId), `Événement ${String(event.firedEventId)}`);
            if (
              event.firedEventId &&
              [...t.scheduled.values()].some(
                (o) => o.event.firedEventId === event.firedEventId && o.event.id !== event.id,
              )
            ) {
              throw duplicate(`Événement ${event.firedEventId}`);
            }
            t.scheduled.set(event.id, { seasonId, event: copy(event) });
          }
        }),
      list: (seasonId) =>
        later(() =>
          [...t.scheduled.values()]
            .filter((e) => e.seasonId === seasonId)
            .map((e) => copy(e.event))
            .sort(byId),
        ),
    },

    formatRuntime: {
      save: (seasonId, runtime) =>
        later(() => {
          require_(db.seasons.has(seasonId), `Saison ${seasonId}`);
          t.runtime.set(seasonId, copy({ actionLog: runtime.actionLog, presence: runtime.presence }));
        }),
      load: (seasonId) => later(() => copy(t.runtime.get(seasonId) ?? { actionLog: [], presence: {} })),
    },
  };
}
