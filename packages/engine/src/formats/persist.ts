/**
 * Persistance du `FormatState` : écriture par dépôts dédiés (objets, missions, équipes, votes, calendrier, suivi)
 * et chargement dans `SimState.ext`. Les événements référencés (attribution, adhésion, décompte, déclenchement)
 * doivent déjà être écrits : appeler `saveFormatState` après `journal.commitTick`, dans la même transaction.
 */
import { DomainError } from '../core/errors.js';
import type { StoragePort, StorageTx } from '../ports/storage.js';
import { emptyFormatState, setFormatState, type FormatState } from '../state/format-state.js';
import type { Id, SimState } from '../state/types.js';

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type FormatRepos = Pick<StorageTx, 'items' | 'missions' | 'teams' | 'votes' | 'schedule' | 'formatRuntime'>;

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
  return fs;
}

/** Clé de `TickBatch.ext` qui porte l'instantané du `FormatState` (déposé par les hooks de format en fin de tick). */
export const FORMAT_BATCH_KEY = 'format';

/**
 * Enveloppe une transaction de stockage : `journal.commitTick` écrit aussi le `FormatState` du lot
 * (`ext['format']`) dans la même transaction, une fois les événements écrits. Sans instantané, rien ne change.
 */
export function withFormatCommit(tx: StorageTx): StorageTx {
  return {
    ...tx,
    journal: {
      ...tx.journal,
      async commitTick(batch) {
        await tx.journal.commitTick(batch);
        const snapshot = batch.ext[FORMAT_BATCH_KEY]?.[0] as FormatState | undefined;
        if (!snapshot) return;
        const epoch = await tx.epochs.findById(batch.epochId);
        if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${batch.epochId} introuvable`);
        await saveFormatState(tx, epoch.seasonId, snapshot);
      },
    },
  };
}
