/** Outils des tests de formats dans l'époque : format « Aventure » aux lieux des Palmiers étendus, scheduler complet. */
import {
  type DecisionPolicy,
  type EpochHooks,
  type OutcomeModel,
  type StoragePort,
  parseSeasonFormat,
  withFormats,
} from '@ai-reality/engine';
import type { WorldFixture } from '@ai-reality/testkit';
import { createEpochScheduler } from '../../src/epoch/index.js';
import { fullHooks } from './interaction-kit.js';

type Over = Record<string, unknown>;

/** Calendrier de test : épreuve au jardin (tick 12), conseil des perdants (tick 28), fusion à 6, finale à 3. */
export const TEST_SCHEDULE = [
  { kind: 'challenge', every: 1, tick: 12, params: { type: 'endurance', reward: 'immunity_team', location: 'jardin' } },
  { kind: 'council', every: 1, tick: 28, participants: { losing_team: true }, params: { location: 'conseil' } },
  { kind: 'merge', trigger: { count_active: { lte: 6 } } },
  { kind: 'final', trigger: { count_active: { lte: 3 } }, params: { location: 'conseil' } },
];

export const adventureFormat = (over: Over = {}) =>
  parseSeasonFormat({ format: 'adventure', schedule: TEST_SCHEDULE, ...over });

export interface FormatSchedulerOptions {
  readonly outcome?: OutcomeModel;
  readonly hooks?: EpochHooks;
  readonly format?: ReturnType<typeof adventureFormat>;
  readonly seasonEpochs?: number;
}

export function formatScheduler(storage: StoragePort, decision: DecisionPolicy, options: FormatSchedulerOptions = {}) {
  return createEpochScheduler(
    withFormats({
      storage,
      decision,
      ...(options.outcome ? { outcome: options.outcome } : {}),
      hooks: options.hooks ?? fullHooks(),
      format: options.format ?? adventureFormat(),
      ...(options.seasonEpochs !== undefined ? { seasonEpochs: options.seasonEpochs } : {}),
    }),
  );
}

export const runNumber = (fixture: WorldFixture, number: number) => ({
  worldId: fixture.world.id,
  seasonNumber: fixture.season.number,
  number,
});
