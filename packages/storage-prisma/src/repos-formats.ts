import type {
  FormatRuntime,
  ItemDefNode,
  MissionDefNode,
  MissionReward,
  PlayedItem,
  ScheduledEventNode,
  StorageTx,
  VoteResult,
  VoteRules,
} from '@ai-reality/engine';
import type { Prisma } from '@prisma/client';
import { type Db, asRecord, cmp, guard, toNullableJson } from './support.js';

type FormatRepos = Pick<StorageTx, 'items' | 'missions' | 'teams' | 'votes' | 'schedule' | 'formatRuntime'>;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const byId = <T extends { id: string }>(a: T, b: T): number => cmp(a.id, b.id);

/** `electorate` porte les votants et les objets joués (une seule colonne JSON pour les deux). */
interface ElectorateJson {
  readonly voters: readonly string[];
  readonly played: readonly PlayedItem[];
}

/** Formats de jeu : objets, missions, équipes, votes, calendrier et suivi (`format_runtime`). */
export function formatRepos(db: Db): FormatRepos {
  return {
    items: {
      async upsertDefs(seasonId, defs) {
        for (const d of defs) {
          const data = {
            seasonId,
            slug: d.slug,
            name: d.name,
            description: d.description,
            kind: d.kind,
            effects: json(d.effects),
            transferable: d.transferable,
            expiresAfterEpoch: d.expiresAfterEpoch,
            visualRef: d.visualRef,
          };
          await guard(() => db.itemDef.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data }));
        }
      },
      async listDefs(seasonId) {
        const rows = await db.itemDef.findMany({ where: { seasonId } });
        return rows
          .map((r): ItemDefNode => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            description: r.description,
            kind: r.kind,
            effects: asRecord(r.effects),
            transferable: r.transferable,
            expiresAfterEpoch: r.expiresAfterEpoch,
            visualRef: r.visualRef,
          }))
          .sort(byId);
      },
      async upsertItems(items) {
        for (const i of items) {
          const data = {
            itemDefId: i.itemDefId,
            holderCharacterId: i.holderId,
            locationId: i.locationId,
            hidden: i.hidden,
            searchDifficulty: i.searchDifficulty,
            isFake: i.isFake,
            fakeOfItemDefId: i.fakeOfItemDefId,
            state: i.state,
          };
          await guard(() => db.item.upsert({ where: { id: i.id }, create: { id: i.id, ...data }, update: data }));
        }
      },
      async listItems(seasonId) {
        const rows = await db.item.findMany({ where: { itemDef: { seasonId } } });
        return rows
          .map((r) => ({
            id: r.id,
            itemDefId: r.itemDefId,
            holderId: r.holderCharacterId,
            locationId: r.locationId,
            hidden: r.hidden,
            searchDifficulty: r.searchDifficulty,
            isFake: r.isFake,
            fakeOfItemDefId: r.fakeOfItemDefId,
            state: r.state,
          }))
          .sort(byId);
      },
    },

    missions: {
      async upsertDefs(seasonId, defs) {
        for (const d of defs) {
          const data = {
            seasonId,
            slug: d.slug,
            title: d.title,
            briefing: d.briefing,
            scope: d.scope,
            secrecy: d.secrecy,
            objective: json(d.objective),
            failure: toNullableJson(d.failure),
            reward: json(d.reward),
            penalty: toNullableJson(d.penalty),
            deadlineEpochOffset: d.deadlineEpochOffset,
          };
          await guard(() => db.missionDef.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data }));
        }
      },
      async listDefs(seasonId) {
        const rows = await db.missionDef.findMany({ where: { seasonId } });
        return rows
          .map((r): MissionDefNode => ({
            id: r.id,
            slug: r.slug,
            title: r.title,
            briefing: r.briefing,
            scope: r.scope,
            secrecy: r.secrecy,
            objective: r.objective as MissionDefNode['objective'],
            failure: r.failure as MissionDefNode['failure'],
            reward: r.reward as MissionReward,
            penalty: r.penalty as MissionReward | null,
            deadlineEpochOffset: r.deadlineEpochOffset,
          }))
          .sort(byId);
      },
      async upsertAssignments(assignments) {
        for (const a of assignments) {
          const data = {
            missionDefId: a.missionDefId,
            characterId: a.characterId,
            teamId: a.teamId,
            assignedEventId: a.assignedEventId,
            deadlineEpoch: a.deadlineEpoch,
            status: a.status,
            progress: json(a.progress),
            resolvedEventId: a.resolvedEventId,
          };
          await guard(() =>
            db.missionAssignment.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data }),
          );
        }
      },
      async listAssignments(seasonId) {
        const rows = await db.missionAssignment.findMany({ where: { missionDef: { seasonId } } });
        return rows
          .map((r) => ({
            id: r.id,
            missionDefId: r.missionDefId,
            characterId: r.characterId,
            teamId: r.teamId,
            assignedEventId: r.assignedEventId,
            deadlineEpoch: r.deadlineEpoch,
            status: r.status,
            progress: asRecord(r.progress),
            resolvedEventId: r.resolvedEventId,
          }))
          .sort(byId);
      },
    },

    teams: {
      async upsertTeams(seasonId, teams) {
        for (const t of teams) {
          const data = {
            seasonId,
            slug: t.slug,
            name: t.name,
            color: t.color,
            campLocationId: t.campLocationId,
            createdEpoch: t.createdEpoch,
            dissolvedEpoch: t.dissolvedEpoch,
          };
          await guard(() => db.team.upsert({ where: { id: t.id }, create: { id: t.id, ...data }, update: data }));
        }
      },
      async listTeams(seasonId) {
        const rows = await db.team.findMany({ where: { seasonId } });
        return rows
          .map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            color: r.color,
            campLocationId: r.campLocationId,
            createdEpoch: r.createdEpoch,
            dissolvedEpoch: r.dissolvedEpoch,
          }))
          .sort(byId);
      },
      async upsertMemberships(memberships) {
        for (const m of memberships) {
          const data = { toEpoch: m.toEpoch, joinedEventId: m.joinedEventId };
          await guard(() =>
            db.teamMembership.upsert({
              where: {
                teamId_characterId_fromEpoch: { teamId: m.teamId, characterId: m.characterId, fromEpoch: m.fromEpoch },
              },
              create: { teamId: m.teamId, characterId: m.characterId, fromEpoch: m.fromEpoch, ...data },
              update: data,
            }),
          );
        }
      },
      async listMemberships(seasonId) {
        const rows = await db.teamMembership.findMany({ where: { team: { seasonId } } });
        return rows
          .map((r) => ({
            teamId: r.teamId,
            characterId: r.characterId,
            fromEpoch: r.fromEpoch,
            toEpoch: r.toEpoch,
            joinedEventId: r.joinedEventId,
          }))
          .sort((a, b) => cmp(a.teamId, b.teamId) || cmp(a.characterId, b.characterId) || a.fromEpoch - b.fromEpoch);
      },
    },

    votes: {
      async upsertSessions(sessions) {
        for (const s of sessions) {
          const electorate: ElectorateJson = { voters: s.electorate, played: s.played };
          const data = {
            epochId: s.epochId,
            tick: s.tick,
            sceneId: s.sceneId,
            kind: s.kind,
            electorate: json(electorate),
            rules: json(s.rules),
            result: toNullableJson(s.result),
            eventId: s.eventId,
          };
          await guard(() =>
            db.voteSession.upsert({ where: { id: s.id }, create: { id: s.id, ...data }, update: data }),
          );
        }
      },
      async listSessions(seasonId) {
        const rows = await db.voteSession.findMany({ where: { epoch: { seasonId } } });
        return rows
          .map((r) => {
            const electorate = r.electorate as unknown as ElectorateJson;
            return {
              id: r.id,
              epochId: r.epochId,
              tick: r.tick,
              sceneId: r.sceneId,
              kind: r.kind,
              electorate: [...electorate.voters],
              rules: r.rules as unknown as VoteRules,
              played: [...electorate.played],
              result: r.result as unknown as VoteResult | null,
              eventId: r.eventId,
            };
          })
          .sort(byId);
      },
      async upsertVotes(votes) {
        for (const v of votes) {
          const data = { targetId: v.targetId, decisionId: v.decisionId, revealed: v.revealed };
          await guard(() =>
            db.vote.upsert({
              where: { voteSessionId_voterId: { voteSessionId: v.voteSessionId, voterId: v.voterId } },
              create: { voteSessionId: v.voteSessionId, voterId: v.voterId, ...data },
              update: data,
            }),
          );
        }
      },
      async listVotes(seasonId) {
        const rows = await db.vote.findMany({ where: { voteSession: { epoch: { seasonId } } } });
        return rows
          .map((r) => ({
            voteSessionId: r.voteSessionId,
            voterId: r.voterId,
            targetId: r.targetId,
            decisionId: r.decisionId,
            revealed: r.revealed,
          }))
          .sort((a, b) => cmp(a.voteSessionId, b.voteSessionId) || cmp(a.voterId, b.voterId));
      },
    },

    schedule: {
      async upsert(seasonId, events) {
        for (const e of events) {
          const data = {
            seasonId,
            kind: e.kind,
            epoch: e.epoch,
            tickStart: e.tickStart,
            tickEnd: e.tickEnd,
            trigger: toNullableJson(e.trigger),
            locationId: e.locationId,
            participants: json(e.participants),
            mandatory: e.mandatory,
            announced: e.announced,
            params: json(e.params),
            firedEventId: e.firedEventId,
          };
          await guard(() =>
            db.scheduledEvent.upsert({ where: { id: e.id }, create: { id: e.id, ...data }, update: data }),
          );
        }
      },
      async list(seasonId) {
        const rows = await db.scheduledEvent.findMany({ where: { seasonId } });
        return rows
          .map((r): ScheduledEventNode => ({
            id: r.id,
            kind: r.kind,
            epoch: r.epoch,
            tickStart: r.tickStart,
            tickEnd: r.tickEnd,
            trigger: r.trigger as ScheduledEventNode['trigger'],
            locationId: r.locationId,
            participants: asRecord(r.participants),
            mandatory: r.mandatory,
            announced: r.announced,
            params: asRecord(r.params),
            firedEventId: r.firedEventId,
          }))
          .sort(byId);
      },
    },

    formatRuntime: {
      async save(seasonId, runtime) {
        const data = json({ actionLog: runtime.actionLog, presence: runtime.presence });
        await guard(() =>
          db.formatRuntime.upsert({ where: { seasonId }, create: { seasonId, data }, update: { data } }),
        );
      },
      async load(seasonId) {
        const row = await db.formatRuntime.findUnique({ where: { seasonId } });
        const data = row ? asRecord(row.data) : {};
        return {
          actionLog: (data['actionLog'] as FormatRuntime['actionLog'] | undefined) ?? [],
          presence: (data['presence'] as FormatRuntime['presence'] | undefined) ?? {},
        };
      },
    },
  };
}
