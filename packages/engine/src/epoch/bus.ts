/**
 * Bus d'événements d'une exécution d'époque (services.md §3.1). Synchrone, typé, sans dépendance.
 */
import type { CharacterStatus } from '../ports/storage.js';
import type { EffectRecord, EventRecord, SceneRecord, UtteranceRecord } from '../state/journal.js';
import type { Id } from '../state/types.js';
import type { EpochMetrics } from './metrics.js';

export type Phase = 'init' | 'plan' | 'ticks' | 'economy' | 'memory' | 'close';

export interface EngineEvents {
  'phase.started': { readonly epoch: number; readonly phase: Phase };
  'tick.committed': { readonly epoch: number; readonly tick: number };
  'scene.opened': { readonly scene: SceneRecord };
  'scene.closed': { readonly scene: SceneRecord };
  utterance: { readonly utterance: UtteranceRecord };
  event: { readonly event: EventRecord };
  'effect.applied': { readonly effect: EffectRecord };
  'character.status': { readonly characterId: Id; readonly from: CharacterStatus; readonly to: CharacterStatus };
  /** Durées par phase, appels LLM, jetons et coût estimé de l'époque ; émis juste avant `epoch.completed`. */
  'epoch.metrics': { readonly metrics: EpochMetrics };
  'epoch.completed': { readonly epochId: Id };
}

type Listener<T> = (payload: T) => void;

export class EngineBus {
  readonly #listeners = new Map<keyof EngineEvents, Set<Listener<never>>>();

  on<K extends keyof EngineEvents>(name: K, listener: Listener<EngineEvents[K]>): () => void {
    let set = this.#listeners.get(name);
    if (!set) {
      set = new Set();
      this.#listeners.set(name, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends keyof EngineEvents>(name: K, payload: EngineEvents[K]): void {
    const set = this.#listeners.get(name);
    if (!set) return;
    for (const listener of set) (listener as Listener<EngineEvents[K]>)(payload);
  }
}
