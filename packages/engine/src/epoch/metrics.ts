/** Métriques d'une exécution d'époque : durée par phase, ticks joués, et usage du LLM (voir `llm/budget.ts`). */
import type { LlmMetrics } from '../llm/budget.js';
import type { Id } from '../state/types.js';
import type { Phase } from './bus.js';

export const PHASES: readonly Phase[] = ['init', 'plan', 'ticks', 'economy', 'memory', 'close'];

export interface EpochMetrics {
  readonly epochId: Id;
  readonly number: number;
  /** Durée de chaque phase en millisecondes (0 si la phase n'a pas été jouée : `plan` à la reprise). */
  readonly phaseMs: Readonly<Record<Phase, number>>;
  /** Durée totale de l'exécution, en millisecondes. */
  readonly totalMs: number;
  /** Ticks de la phase 3 joués par cette exécution (hors clôture). */
  readonly ticks: number;
  /** Absent si le scheduler n'a pas de compteur LLM. */
  readonly llm: LlmMetrics | null;
}

/** Chronomètre des phases : `enter` clôt la phase en cours et ouvre la suivante. */
export class PhaseTimer {
  readonly #now: () => number;
  readonly #startedAt: number;
  readonly #ms: Record<Phase, number> = { init: 0, plan: 0, ticks: 0, economy: 0, memory: 0, close: 0 };
  #current: { readonly phase: Phase; readonly since: number } | null = null;

  constructor(now: () => number) {
    this.#now = now;
    this.#startedAt = now();
  }

  enter(phase: Phase): void {
    this.#stop();
    this.#current = { phase, since: this.#now() };
  }

  /** Clôt la phase en cours et rend les durées. */
  finish(): { readonly phaseMs: Readonly<Record<Phase, number>>; readonly totalMs: number } {
    this.#stop();
    return { phaseMs: { ...this.#ms }, totalMs: this.#now() - this.#startedAt };
  }

  #stop(): void {
    if (!this.#current) return;
    this.#ms[this.#current.phase] += this.#now() - this.#current.since;
    this.#current = null;
  }
}
