/** Saison complète sans LLM (utilité + issues probabilistes) pour les tests de rejeu. */
import {
  AgendaDecisionPolicy,
  ProbabilisticOutcomeModel,
  UtilityDecisionPolicy,
  createEpochScheduler,
  economyHook,
  interactionHook,
  type CharacterStateRecord,
  type EpochJournal,
  type EventRecord,
  type Id,
  type StoragePort,
} from '../../src/index.js';
import { aWorld, seedWorld, type WorldFixture } from '@ai-reality/testkit';

export interface PlayedSeason {
  readonly fixture: WorldFixture;
  readonly worldId: Id;
  readonly seasonNumber: number;
}

/** Joue `epochs` époques de la Maison des Palmiers (politique d'utilité, issues probabilistes, économie). */
export async function playSeason(storage: StoragePort, epochs: number, seed = 'rejeu-m8'): Promise<PlayedSeason> {
  const fixture = await seedWorld(storage, aWorld().withSeed(seed).build());
  const scheduler = createEpochScheduler({
    storage,
    decision: new AgendaDecisionPolicy(new UtilityDecisionPolicy()),
    outcome: new ProbabilisticOutcomeModel(),
    hooks: {
      tick: [interactionHook()],
      economy: economyHook({
        eliminate: (ctx) =>
          Object.values(ctx.state.characters)
            .filter((c) => c.status === 'elimination_pending')
            .map((c) => c.id),
      }),
    },
  });
  for (let number = 0; number < epochs; number++) {
    await scheduler.run({ worldId: fixture.world.id, seasonNumber: fixture.season.number, number }).done;
  }
  return { fixture, worldId: fixture.world.id, seasonNumber: fixture.season.number };
}

export interface Tamper {
  /** Remplace le journal d'une époque tel que le lit le moteur. */
  readonly journal?: (journal: EpochJournal) => EpochJournal;
  readonly events?: (events: EventRecord[]) => EventRecord[];
  readonly states?: (rows: CharacterStateRecord[]) => CharacterStateRecord[];
}

/** Un `StoragePort` qui altère ce que les lectures renvoient (la base n'est jamais modifiée) : journal corrompu de test. */
export function tampered(storage: StoragePort, tamper: Tamper): StoragePort {
  return {
    tx: (fn) =>
      storage.tx((s) =>
        fn({
          ...s,
          journal: {
            ...s.journal,
            read: async (epochId) => {
              const journal = await s.journal.read(epochId);
              return tamper.journal ? tamper.journal(journal) : journal;
            },
            eventsOfWorld: async (worldId) => {
              const events = await s.journal.eventsOfWorld(worldId);
              return tamper.events ? tamper.events(events) : events;
            },
          },
          characterStates: {
            ...s.characterStates,
            listByEpoch: async (epochId) => {
              const rows = await s.characterStates.listByEpoch(epochId);
              return tamper.states ? tamper.states(rows) : rows;
            },
          },
        }),
      ),
  };
}
