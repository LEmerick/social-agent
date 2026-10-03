/** Outils des tests d'interactions : scheduler complet (interactions + économie), instantané, rejeu depuis le journal. */
import {
  type DecisionPolicy,
  type EpochHooks,
  type Id,
  type OutcomeModel,
  type SimState,
  type StoragePort,
  projectedValues,
  replayEffects,
  replayStatuses,
} from '@ai-reality/engine';
import { type WorldFixture, simStateOf } from '@ai-reality/testkit';
import { economyHook, interactionHook } from '../../src/interaction/index.js';
import { createEpochScheduler } from '../../src/epoch/index.js';

export const fullHooks = (extraTick: EpochHooks['tick'] = []): EpochHooks => ({
  tick: [interactionHook(), ...extraTick],
  economy: economyHook(),
});

export function interactionScheduler(
  storage: StoragePort,
  decision: DecisionPolicy,
  outcome?: OutcomeModel,
  hooks: EpochHooks = fullHooks(),
) {
  return createEpochScheduler({ storage, decision, ...(outcome ? { outcome } : {}), hooks });
}

export const runOf = (fixture: WorldFixture, number = 0) => ({
  worldId: fixture.world.id,
  seasonNumber: fixture.season.number,
  number,
});

/** Rejoue tous les effets du journal sur l'état initial du monde et rend l'état reconstruit. */
export async function replayedFromJournal(storage: StoragePort, fixture: WorldFixture, epochId: Id): Promise<SimState> {
  const journal = await storage.tx((s) => s.journal.read(epochId));
  const rebuilt = replayEffects(simStateOf(fixture), journal.effects);
  return replayStatuses(rebuilt, journal.events);
}

export { projectedValues };
