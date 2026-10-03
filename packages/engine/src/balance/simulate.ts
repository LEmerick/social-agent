/**
 * Simulateur d'équilibrage hors ligne (implementation-plan.md M9, decision-model.md §7) : N saisons sans LLM,
 * politiques d'utilité et d'issues probabilistes par défaut, scheduler + `interactionHook` + économie.
 *
 * Le moteur ne dépend d'aucun adaptateur de stockage : l'appelant fournit un monde frais par saison
 * (`newSeason`, typiquement `createMemoryStorage()` + `seedWorld`). Avec le même `newSeason` (mêmes graines) et les
 * mêmes politiques, le rapport est identique d'une exécution à l'autre.
 */
import { AgendaDecisionPolicy } from '../knowledge/agenda.js';
import { ProbabilisticOutcomeModel } from '../decision/model/probabilistic-outcome.js';
import { UtilityDecisionPolicy } from '../decision/model/utility-policy.js';
import type { DecisionPolicy, OutcomeModel } from '../decision/ports.js';
import { economyHook } from '../economy/hook.js';
import { createEpochScheduler } from '../epoch/scheduler.js';
import { interactionHook } from '../interaction/engine.js';
import type { StoragePort } from '../ports/storage.js';
import { loadSimState } from '../state/load.js';
import type { Id } from '../state/types.js';

/** Un monde prêt à jouer : une saison fraîche dans son stockage. */
export interface BalanceWorld {
  readonly storage: StoragePort;
  readonly worldId: Id;
  readonly seasonNumber: number;
}

export interface BalanceOptions {
  /** Nombre de saisons à jouer. */
  readonly seasons: number;
  /** Nombre d'époques par saison. */
  readonly epochs: number;
  /** Crée la saison `index` (0-based) ; une graine différente par saison donne des saisons différentes. */
  newSeason(index: number): Promise<BalanceWorld>;
  /** Défaut : `AgendaDecisionPolicy(UtilityDecisionPolicy)`. */
  readonly decision?: DecisionPolicy;
  /** Défaut : `ProbabilisticOutcomeModel`. */
  readonly outcome?: OutcomeModel;
}

export interface BalanceReport {
  readonly seasons: number;
  readonly epochsPerSeason: number;
  readonly interactions: number;
  /** Durée moyenne de survie, en époques jouées avant élimination (plafonnée à `epochsPerSeason`). */
  readonly meanSurvivalEpochs: number;
  /** Part des personnages éliminés avant la fin de la saison. */
  readonly eliminationRate: number;
  /** Trahisons (`break_alliance` non esquivée, ou confrontation qui démasque un traître) rapportées au nombre d'interactions. */
  readonly betrayals: number;
  readonly betrayalRate: number;
  readonly finalCredits: { readonly mean: number; readonly min: number; readonly max: number };
  /** Part de chaque action dans les interactions jouées. */
  readonly actionDistribution: Readonly<Record<string, number>>;
  /** Part de chaque issue. */
  readonly outcomeDistribution: Readonly<Record<string, number>>;
}

const byKey = <T extends string>(counts: Map<T, number>, total: number): Record<T, number> =>
  Object.fromEntries(
    [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => [k, total === 0 ? 0 : n / total]),
  ) as Record<T, number>;

export async function simulateBalance(options: BalanceOptions): Promise<BalanceReport> {
  const decision = options.decision ?? new AgendaDecisionPolicy(new UtilityDecisionPolicy());
  const outcome = options.outcome ?? new ProbabilisticOutcomeModel();

  const actions = new Map<string, number>();
  const outcomes = new Map<string, number>();
  let interactions = 0;
  let betrayals = 0;
  let survival = 0;
  let eliminated = 0;
  let characters = 0;
  const credits: number[] = [];

  for (let season = 0; season < options.seasons; season++) {
    const world = await options.newSeason(season);
    const scheduler = createEpochScheduler({
      storage: world.storage,
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
    const survived = new Map<Id, number>();

    for (let epoch = 0; epoch < options.epochs; epoch++) {
      const { epochId } = await scheduler.run({
        worldId: world.worldId,
        seasonNumber: world.seasonNumber,
        number: epoch,
      }).done;
      const journal = await world.storage.tx((s) => s.journal.read(epochId));
      for (const i of journal.interactions) {
        interactions += 1;
        actions.set(i.action, (actions.get(i.action) ?? 0) + 1);
        if (i.outcome !== null) outcomes.set(i.outcome, (outcomes.get(i.outcome) ?? 0) + 1);
        const facts = (i.classification?.['facts'] ?? {}) as Readonly<Record<string, unknown>>;
        const betrayal =
          (i.action === 'break_alliance' && i.outcome !== 'deflected') || typeof facts['traitorId'] === 'string';
        if (betrayal) betrayals += 1;
      }
      const state = await loadSimState(world.storage, world.worldId, world.seasonNumber, { epochNumber: epoch + 1 });
      for (const c of Object.values(state.characters)) {
        if (c.status === 'eliminated' && !survived.has(c.id)) survived.set(c.id, epoch + 1);
      }
    }

    const final = await loadSimState(world.storage, world.worldId, world.seasonNumber, { epochNumber: options.epochs });
    for (const c of Object.values(final.characters)) {
      characters += 1;
      credits.push(c.credits);
      const lived = survived.get(c.id);
      if (lived !== undefined) eliminated += 1;
      survival += lived ?? options.epochs;
    }
  }

  return {
    seasons: options.seasons,
    epochsPerSeason: options.epochs,
    interactions,
    meanSurvivalEpochs: characters === 0 ? 0 : survival / characters,
    eliminationRate: characters === 0 ? 0 : eliminated / characters,
    betrayals,
    betrayalRate: interactions === 0 ? 0 : betrayals / interactions,
    finalCredits: {
      mean: credits.length === 0 ? 0 : credits.reduce((s, c) => s + c, 0) / credits.length,
      min: credits.length === 0 ? 0 : Math.min(...credits),
      max: credits.length === 0 ? 0 : Math.max(...credits),
    },
    actionDistribution: byKey(actions, interactions),
    outcomeDistribution: byKey(outcomes, interactions),
  };
}
