/** Outils des benchmarks et des mesures de performance : stockage instrumenté, époque scriptée à 12 personnages. */
import {
  type StoragePort,
  type StorageTx,
  AgendaDecisionPolicy,
  HeuristicOutcomeModel,
  UtilityDecisionPolicy,
  createEpochScheduler,
  economyHook,
  interactionHook,
} from '../../src/index.js';
import { adventureWorld, seedWorld, type WorldFixture } from '@ai-reality/testkit';

export interface PortCounts {
  /** Transactions ouvertes. */
  tx: number;
  /** Appels de méthodes de dépôts, au total et par `dépôt.méthode`. */
  calls: number;
  byMethod: Record<string, number>;
}

/** Enveloppe un `StoragePort` et compte les transactions et les appels aux dépôts (aucune écriture n'est modifiée). */
export function countingStorage(inner: StoragePort): { storage: StoragePort; counts: PortCounts; reset(): void } {
  const counts: PortCounts = { tx: 0, calls: 0, byMethod: {} };
  const wrapRepo = (name: string, repo: object): object =>
    new Proxy(repo, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const key = `${name}.${String(prop)}`;
          counts.calls += 1;
          counts.byMethod[key] = (counts.byMethod[key] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  const wrapTx = (tx: StorageTx): StorageTx =>
    new Proxy(tx, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        return value !== null && typeof value === 'object' ? wrapRepo(String(prop), value) : value;
      },
    });
  return {
    counts,
    storage: {
      tx: (fn) => {
        counts.tx += 1;
        return inner.tx((s) => fn(wrapTx(s)));
      },
    },
    reset() {
      counts.tx = 0;
      counts.calls = 0;
      counts.byMethod = {};
    },
  };
}

/** Une saison « adventure » : 12 personnages (les 4 des Palmiers et 8 autres). */
export const twelveCharacters = (seed = 'bench-m8b'): WorldFixture =>
  adventureWorld({ seed, characters: 12, economy: true });

/** Époque scriptée (utilité, issues heuristiques, économie), sans LLM, sur le stockage donné. */
export async function playScriptedEpoch(storage: StoragePort, fixture: WorldFixture, number = 0) {
  const scheduler = createEpochScheduler({
    storage,
    decision: new AgendaDecisionPolicy(new UtilityDecisionPolicy()),
    outcome: new HeuristicOutcomeModel(),
    hooks: { tick: [interactionHook()], economy: economyHook() },
  });
  return scheduler.run({ worldId: fixture.world.id, seasonNumber: fixture.season.number, number }).done;
}

export async function seeded12(storage: StoragePort, seed?: string): Promise<WorldFixture> {
  return seedWorld(storage, twelveCharacters(seed));
}
