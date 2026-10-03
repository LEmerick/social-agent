/** Jeu d'une époque sans LLM : utilité + issues probabilistes (défaut) ou tirage uniforme + issues heuristiques. */
import {
  AgendaDecisionPolicy,
  HeuristicOutcomeModel,
  ProbabilisticOutcomeModel,
  UtilityDecisionPolicy,
  createEpochScheduler,
  economyHook,
  interactionHook,
  type DecisionPolicy,
  type EpochScheduler,
  type Id,
  type OutcomeModel,
  type StoragePort,
} from '@ai-reality/engine';
import { UniformRandomPolicy } from '@ai-reality/testkit';
import { CliError } from './io.js';

export type PolicyName = 'utility' | 'random';

interface Scene {
  readonly storage: StoragePort;
  readonly worldId: Id;
  readonly seasonNumber: number;
}

function schedulerFor(storage: StoragePort, policy: PolicyName): EpochScheduler {
  const decision: DecisionPolicy =
    policy === 'utility'
      ? new AgendaDecisionPolicy(new UtilityDecisionPolicy())
      : new UniformRandomPolicy({ moveProbability: 0.35, idleProbability: 0.2 });
  const outcome: OutcomeModel = policy === 'utility' ? new ProbabilisticOutcomeModel() : new HeuristicOutcomeModel();
  return createEpochScheduler({
    storage,
    decision,
    outcome,
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
}

export interface PlayedEpoch {
  readonly epochId: Id;
  readonly resumed: boolean;
}

/**
 * Joue l'époque `number`, ou la reprend si elle a été interrompue (`running`/`failed`).
 * Une époque déjà terminée est une erreur : le journal est en ajout seul.
 */
export async function playEpoch(scene: Scene, number: number, policy: PolicyName): Promise<PlayedEpoch> {
  const existing = await scene.storage.tx((s) => s.epochs.findByNumber(scene.worldId, number));
  const scheduler = schedulerFor(scene.storage, policy);
  if (existing?.status === 'completed') {
    throw new CliError(`L'époque ${String(number)} est déjà terminée : le journal est en ajout seul.`);
  }
  if (existing) {
    await scheduler.resume(existing.id).done;
    return { epochId: existing.id, resumed: true };
  }
  const { epochId } = await scheduler.run({ worldId: scene.worldId, seasonNumber: scene.seasonNumber, number }).done;
  return { epochId, resumed: false };
}
