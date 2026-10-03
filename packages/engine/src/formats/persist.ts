/**
 * Persistance du `FormatState` : écriture par dépôts dédiés (objets, missions, équipes, votes, calendrier, suivi)
 * et chargement dans `SimState.ext`. Les événements référencés (attribution, adhésion, décompte, déclenchement)
 * doivent déjà être écrits : appeler `saveFormatState` après `journal.commitTick`, dans la même transaction.
 */
import { DomainError } from '../core/errors.js';
import type { StoragePort, StorageTx } from '../ports/storage.js';
import {
  emptyFormatState,
  setFormatState,
  type FormatState,
  type ItemDefNode,
  type ItemNode,
  type MissionAssignmentNode,
  type MissionDefNode,
  type ScheduledEventNode,
  type TeamMembershipNode,
  type TeamNode,
  type VoteNode,
  type VoteSessionNode,
} from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type FormatRepos = Pick<StorageTx, 'items' | 'missions' | 'teams' | 'votes' | 'schedule' | 'formatRuntime'>;

/**
 * Ce qui a changé dans le `FormatState` depuis la dernière écriture de l'exécution (persistance différentielle).
 * Chaque section est indexée par la clé de l'entité ; `runtime` n'est présent que si le suivi a changé.
 */
export interface FormatDelta {
  itemDefs: Record<string, ItemDefNode>;
  missionDefs: Record<string, MissionDefNode>;
  teams: Record<string, TeamNode>;
  scheduled: Record<string, ScheduledEventNode>;
  items: Record<string, ItemNode>;
  assignments: Record<string, MissionAssignmentNode>;
  memberships: Record<string, TeamMembershipNode>;
  voteSessions: Record<string, VoteSessionNode>;
  votes: Record<string, VoteNode>;
  runtime: { actionLog: FormatState['actionLog']; presence: FormatState['presence'] } | null;
}

const SECTIONS = [
  'itemDefs',
  'missionDefs',
  'teams',
  'scheduled',
  'items',
  'assignments',
  'memberships',
  'voteSessions',
  'votes',
] as const;

const emptyDelta = (): FormatDelta => ({
  itemDefs: {},
  missionDefs: {},
  teams: {},
  scheduled: {},
  items: {},
  assignments: {},
  memberships: {},
  voteSessions: {},
  votes: {},
  runtime: null,
});

const isEmptyDelta = (d: FormatDelta): boolean => d.runtime === null && SECTIONS.every((k) => isEmpty(d[k]));
const isEmpty = (record: object): boolean => {
  for (const _ in record) return false;
  return true;
};

/** Fusionne deux deltas d'un même tick : `later` l'emporte sur `earlier` pour une même clé. */
export function mergeFormatDeltas(earlier: FormatDelta, later: FormatDelta): FormatDelta {
  const merged = emptyDelta();
  for (const k of SECTIONS) Object.assign(merged[k] as Record<string, unknown>, earlier[k], later[k]);
  merged.runtime = later.runtime ?? earlier.runtime;
  return merged;
}

/** Empreinte JSON de chaque entité déjà écrite, par exécution (un `SimState` rechargé repart de zéro : tout est réécrit). */
const baselines = new WeakMap<object, Map<string, string>>();

/**
 * Compare `fs` à ce que l'exécution a déjà déposé et renvoie les seules entités nouvelles ou modifiées
 * (`null` si rien n'a changé). La première comparaison d'un `SimState` renvoie tout le `FormatState`.
 */
export function diffFormat(owner: object, fs: Readonly<FormatState>): FormatDelta | null {
  let baseline = baselines.get(owner);
  if (!baseline) {
    baseline = new Map();
    baselines.set(owner, baseline);
  }
  const delta = emptyDelta();
  const track = <T>(section: string, key: string, entity: T, into: Record<string, T>): void => {
    const id = `${section}|${key}`;
    const json = JSON.stringify(entity);
    if (baseline.get(id) === json) return;
    baseline.set(id, json);
    into[key] = entity;
  };
  for (const key of Object.keys(fs.itemDefs)) track('itemDefs', key, fs.itemDefs[key], delta.itemDefs);
  for (const key of Object.keys(fs.missionDefs)) track('missionDefs', key, fs.missionDefs[key], delta.missionDefs);
  for (const key of Object.keys(fs.teams)) track('teams', key, fs.teams[key], delta.teams);
  for (const key of Object.keys(fs.scheduled)) track('scheduled', key, fs.scheduled[key], delta.scheduled);
  for (const key of Object.keys(fs.items)) track('items', key, fs.items[key], delta.items);
  for (const key of Object.keys(fs.assignments)) track('assignments', key, fs.assignments[key], delta.assignments);
  for (const m of fs.memberships) {
    track('memberships', `${m.teamId}|${m.characterId}|${String(m.fromEpoch)}`, m, delta.memberships);
  }
  for (const key of Object.keys(fs.voteSessions)) track('voteSessions', key, fs.voteSessions[key], delta.voteSessions);
  for (const v of fs.votes) track('votes', `${v.voteSessionId}|${v.voterId}`, v, delta.votes);

  const runtime = { actionLog: fs.actionLog, presence: fs.presence };
  const runtimeJson = JSON.stringify(runtime);
  if (baseline.get('runtime') !== runtimeJson) {
    baseline.set('runtime', runtimeJson);
    delta.runtime = runtime;
  }
  return isEmptyDelta(delta) ? null : delta;
}

/** Le `FormatState` que `owner` vient de lire en base devient sa référence : seuls les changements ultérieurs seront écrits. */
export function seedFormatBaseline(owner: object, fs: Readonly<FormatState>): void {
  baselines.delete(owner);
  diffFormat(owner, fs);
}

const sortedValues = <T extends { id: string }>(record: Readonly<Record<string, T>>): T[] =>
  Object.values(record).sort(byId);

/** Écrit un delta (upserts idempotents, dans l'ordre des dépendances). */
export async function saveFormatDelta(tx: FormatRepos, seasonId: Id, delta: FormatDelta): Promise<void> {
  const nonEmpty = <T>(list: T[], write: (list: T[]) => Promise<void>): Promise<void> =>
    list.length > 0 ? write(list) : Promise.resolve();
  await nonEmpty(sortedValues(delta.itemDefs), (l) => tx.items.upsertDefs(seasonId, l));
  await nonEmpty(sortedValues(delta.missionDefs), (l) => tx.missions.upsertDefs(seasonId, l));
  await nonEmpty(sortedValues(delta.teams), (l) => tx.teams.upsertTeams(seasonId, l));
  await nonEmpty(sortedValues(delta.scheduled), (l) => tx.schedule.upsert(seasonId, l));
  await nonEmpty(sortedValues(delta.items), (l) => tx.items.upsertItems(l));
  await nonEmpty(sortedValues(delta.assignments), (l) => tx.missions.upsertAssignments(l));
  await nonEmpty(Object.values(delta.memberships), (l) => tx.teams.upsertMemberships(l));
  await nonEmpty(sortedValues(delta.voteSessions), (l) => tx.votes.upsertSessions(l));
  await nonEmpty(Object.values(delta.votes), (l) => tx.votes.upsertVotes(l));
  if (delta.runtime) await tx.formatRuntime.save(seasonId, delta.runtime);
}

/** Écrit tout le `FormatState` (upserts idempotents, dans l'ordre des dépendances). */
export async function saveFormatState(tx: FormatRepos, seasonId: Id, fs: FormatState): Promise<void> {
  await tx.items.upsertDefs(seasonId, Object.values(fs.itemDefs).sort(byId));
  await tx.missions.upsertDefs(seasonId, Object.values(fs.missionDefs).sort(byId));
  await tx.teams.upsertTeams(seasonId, Object.values(fs.teams).sort(byId));
  await tx.schedule.upsert(seasonId, Object.values(fs.scheduled).sort(byId));
  await tx.items.upsertItems(Object.values(fs.items).sort(byId));
  await tx.missions.upsertAssignments(Object.values(fs.assignments).sort(byId));
  await tx.teams.upsertMemberships(fs.memberships);
  await tx.votes.upsertSessions(Object.values(fs.voteSessions).sort(byId));
  await tx.votes.upsertVotes(fs.votes);
  await tx.formatRuntime.save(seasonId, { actionLog: fs.actionLog, presence: fs.presence });
}

/** Lit le `FormatState` d'une saison (vide si la saison n'a pas de format en base). */
export async function readFormatState(tx: FormatRepos, seasonId: Id): Promise<FormatState> {
  const [itemDefs, items, missionDefs, assignments, teams, memberships, sessions, votes, scheduled, runtime] =
    await Promise.all([
      tx.items.listDefs(seasonId),
      tx.items.listItems(seasonId),
      tx.missions.listDefs(seasonId),
      tx.missions.listAssignments(seasonId),
      tx.teams.listTeams(seasonId),
      tx.teams.listMemberships(seasonId),
      tx.votes.listSessions(seasonId),
      tx.votes.listVotes(seasonId),
      tx.schedule.list(seasonId),
      tx.formatRuntime.load(seasonId),
    ]);
  const keyed = <T extends { id: string }>(list: readonly T[]): Record<Id, T> =>
    Object.fromEntries(list.map((x) => [x.id, x]));
  return {
    ...emptyFormatState(),
    itemDefs: keyed(itemDefs),
    items: keyed(items),
    missionDefs: keyed(missionDefs),
    assignments: keyed(assignments),
    teams: keyed(teams),
    memberships,
    voteSessions: keyed(sessions),
    votes,
    scheduled: keyed(scheduled),
    actionLog: [...runtime.actionLog],
    presence: { ...runtime.presence },
  };
}

export const saveFormat = (storage: StoragePort, seasonId: Id, fs: FormatState): Promise<void> =>
  storage.tx((tx) => saveFormatState(tx, seasonId, fs));

/** Charge le `FormatState` d'une saison (transaction de lecture). */
export const loadFormatState = (storage: StoragePort, seasonId: Id): Promise<FormatState> =>
  storage.tx((tx) => readFormatState(tx, seasonId));

/** Charge le `FormatState` de la saison du `SimState` et le range dans `state.ext`. */
export async function loadFormatInto(storage: StoragePort, state: SimState): Promise<FormatState> {
  const fs = await loadFormatState(storage, state.season.id);
  setFormatState(state, fs);
  seedFormatBaseline(state, fs);
  return fs;
}

/** Clé de `TickBatch.ext` qui porte l'instantané du `FormatState` (déposé par les hooks de format en fin de tick). */
export const FORMAT_BATCH_KEY = 'format';

/** Index du delta dans `ext['format']` (l'index 0 garde l'instantané complet). */
export const FORMAT_DELTA_INDEX = 1;

/**
 * Enveloppe une transaction de stockage : `journal.commitTick` écrit aussi le `FormatState` du lot
 * (`ext['format']`) dans la même transaction, une fois les événements écrits : le delta s'il est fourni
 * (seules les entités modifiées), sinon l'instantané complet. Sans instantané, rien ne change.
 */
export function withFormatCommit(tx: StorageTx): StorageTx {
  return {
    ...tx,
    journal: {
      ...tx.journal,
      async commitTick(batch) {
        await tx.journal.commitTick(batch);
        const staged = batch.ext[FORMAT_BATCH_KEY];
        const snapshot = staged?.[0] as FormatState | undefined;
        if (!snapshot) return;
        const epoch = await tx.epochs.findById(batch.epochId);
        if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${batch.epochId} introuvable`);
        const delta = staged?.[FORMAT_DELTA_INDEX] as FormatDelta | undefined;
        if (delta) await saveFormatDelta(tx, epoch.seasonId, delta);
        else await saveFormatState(tx, epoch.seasonId, snapshot);
      },
    },
  };
}
