/**
 * Chargement d'un `SimState` avec les données de reprise (`character_state.runtime`) que `loadSimState`
 * ne relit pas : position, agenda, compteurs d'habituation, zone d'arrivée d'un trajet en cours.
 */
import { z } from 'zod';
import { DomainError } from '../core/errors.js';
import type { StoragePort } from '../ports/storage.js';
import { loadSimState } from './load.js';
import type { Id, Position, SimState } from './types.js';

const Nullable = z.string().nullable();

const PositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('at'), locationId: z.string(), zoneId: Nullable }),
  z.object({
    kind: z.literal('transit'),
    fromLocationId: z.string(),
    toLocationId: z.string(),
    arrivalTick: z.number().int(),
  }),
  z.object({ kind: z.literal('offstage'), reason: z.string(), lastLocationId: Nullable }),
]);

const IntentionSchema = z.object({
  kind: z.enum(['talk_to', 'avoid', 'attend', 'tell', 'go_to']),
  targetId: Nullable,
  goal: Nullable,
  factId: Nullable,
  locationId: Nullable,
  priority: z.number(),
});

const RuntimeSchema = z.object({
  position: PositionSchema,
  transitZoneId: Nullable.optional(),
  agenda: z.array(IntentionSchema),
  restrictedSinceEpoch: z.number().int().nullable(),
  dailyCounts: z.record(z.string(), z.number()),
});

/** Zone d'arrivée des personnages en transit (le `Position` ne la porte pas). */
export type TransitZones = Map<Id, Id | null>;

/** Dernier lieu connu d'une position, pour renseigner `lastLocationId` d'un hors-jeu. */
export function lastLocationOf(position: Position): Id | null {
  switch (position.kind) {
    case 'at':
      return position.locationId;
    case 'transit':
      return position.toLocationId;
    case 'offstage':
      return position.lastLocationId;
  }
}

/** Données de reprise d'un personnage, telles qu'écrites dans `CharacterStateRecord.runtime`. */
export function runtimeOf(
  state: Readonly<SimState>,
  characterId: Id,
  transitZones: TransitZones,
): Record<string, unknown> {
  const character = state.characters[characterId];
  const position = state.positions[characterId];
  if (!character || !position) throw new DomainError('NOT_FOUND', `Personnage ${characterId} absent du SimState`);
  const prefix = `${characterId}|`;
  const dailyCounts = Object.fromEntries(Object.entries(state.dailyCounts).filter(([k]) => k.startsWith(prefix)));
  return structuredClone({
    position,
    transitZoneId: transitZones.get(characterId) ?? null,
    agenda: character.agenda,
    restrictedSinceEpoch: character.restrictedSinceEpoch,
    dailyCounts,
  });
}

export interface LoadRuntimeOptions {
  readonly epochNumber: number;
  /**
   * `true` : reprise d'une époque interrompue, on restitue tout (position, trajets, compteurs du jour).
   * `false` : nouvelle époque, on ne garde que l'agenda et l'état de restriction ; tout le monde repart hors-jeu
   * (`initial`) en se souvenant du dernier lieu.
   */
  readonly resume: boolean;
}

export async function loadSimStateWithRuntime(
  storage: StoragePort,
  worldId: Id,
  seasonNumber: number,
  options: LoadRuntimeOptions,
): Promise<{ state: SimState; transitZones: TransitZones }> {
  const state = await loadSimState(storage, worldId, seasonNumber, { epochNumber: options.epochNumber });
  const rows = await storage.tx((s) => s.characterStates.latest(worldId));
  const transitZones: TransitZones = new Map();

  for (const row of rows) {
    const character = state.characters[row.characterId];
    if (!character || Object.keys(row.runtime).length === 0) continue;
    const parsed = RuntimeSchema.safeParse(row.runtime);
    if (!parsed.success) {
      throw new DomainError('CORRUPT_RUNTIME', `Données de reprise illisibles pour ${row.characterId}`);
    }
    const runtime = parsed.data;
    character.agenda = runtime.agenda;
    character.restrictedSinceEpoch = runtime.restrictedSinceEpoch;
    if (options.resume) {
      state.positions[row.characterId] = runtime.position;
      Object.assign(state.dailyCounts, runtime.dailyCounts);
      if (runtime.position.kind === 'transit') transitZones.set(row.characterId, runtime.transitZoneId ?? null);
    } else {
      state.positions[row.characterId] = {
        kind: 'offstage',
        reason: 'initial',
        lastLocationId: lastLocationOf(runtime.position),
      };
    }
  }
  return { state, transitZones };
}
