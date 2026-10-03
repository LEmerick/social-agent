/**
 * Vote du public (format villa, game-formats.md §5) : la session `public` est ouverte par le conseil ; son résultat est
 * injecté de l'extérieur (API) entre deux époques. L'injection s'écrit comme un lot de l'époque qui a ouvert la session
 * (événements `vote_tallied`, `status_changed`, état du personnage éliminé, `FormatState`), en une transaction.
 */
import { DomainError } from '../core/errors.js';
import { Rng } from '../core/rng.js';
import { simIdFactory } from '../core/sim-ids.js';
import type { StoragePort } from '../ports/storage.js';
import { loadSimState } from '../state/load.js';
import { emptyTickBatch } from '../state/journal.js';
import type { MutableTickBatch } from '../epoch/types.js';
import type { VoteResult } from '../state/format-state.js';
import type { Id } from '../state/types.js';
import { absorbInto } from './hook-kit.js';
import { loadFormatInto } from './persist.js';
import { injectPublic, type PublicVoteInput } from './votes.js';

export interface PublicVoteRequest extends PublicVoteInput {
  readonly worldId: Id;
  readonly seasonNumber: number;
  readonly sessionId: Id;
}

/** Injecte les voix du public dans la session et persiste le résultat. Renvoie le décompte. */
export async function injectPublicVote(storage: StoragePort, request: PublicVoteRequest): Promise<VoteResult> {
  const state = await loadSimState(storage, request.worldId, request.seasonNumber);
  const fs = await loadFormatInto(storage, state);
  const session = fs.voteSessions[request.sessionId];
  if (!session) throw new DomainError('NOT_FOUND', `Session de vote ${request.sessionId} inconnue`);
  const epoch = await storage.tx((s) => s.epochs.findById(session.epochId));
  if (!epoch) throw new DomainError('NOT_FOUND', `Époque ${session.epochId} introuvable`);
  const tick = state.world.config.ticksPerEpoch;
  state.epoch = { id: epoch.id, number: epoch.number };
  state.tick = tick;

  const fc = {
    ids: simIdFactory(state.world.seed, state.world.config, epoch.number, tick, 'public-vote'),
    epochId: epoch.id,
    epoch: epoch.number,
    tick,
  };
  const rng = Rng.derive(state.world.seed, epoch.number, tick, 'public-vote', request.sessionId);
  const injected = injectPublic(state, fc, request.sessionId, request, rng);

  const batch = emptyTickBatch(epoch.id, tick) as MutableTickBatch;
  absorbInto(batch, state, injected);
  const eliminated = injected.statusChanges.map((c) => c.characterId);
  await storage.tx(async (s) => {
    const rows = await s.characterStates.listByEpoch(epoch.id);
    batch.characterStates = rows
      .filter((r) => eliminated.includes(r.characterId))
      .map((r) => ({ ...r, status: 'eliminated' as const }));
    batch.ext = { format: [fs] };
    await s.journal.commitTick(batch);
  });
  return injected.result;
}
