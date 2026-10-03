/**
 * Exécution en pas de course déterministe de tâches asynchrones concurrentes (parallélisme des scènes d'un tick).
 *
 * Chaque tâche est une coroutine ; un jeton (`turn`) circule en anneau, dans l'ordre des indices. Une tâche ne
 * s'exécute (hors attente d'un appel externe) que lorsqu'elle tient le jeton. Elle le passe à la suivante au moment
 * où elle lance un appel LLM (`lockstepAround`), puis le réclame dès que l'appel est revenu. Les appels de plusieurs
 * tâches sont donc en vol en même temps, mais tout le code qui lit ou écrit l'état s'exécute dans un ordre qui ne
 * dépend que de la structure des tâches, jamais de l'ordre dans lequel les réponses arrivent.
 *
 * Une tâche qui ne fait aucun appel garde le jeton jusqu'à sa fin : sans LLM, l'ordre est celui des indices.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

class Ring {
  readonly #done: boolean[];
  readonly #waiters = new Map<number, () => void>();
  #turn = 0;

  constructor(size: number) {
    this.#done = Array.from({ length: size }, () => false);
  }

  /** Attend que le jeton soit à `index`. */
  acquire(index: number): Promise<void> {
    if (this.#turn === index) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#waiters.set(index, resolve);
    });
  }

  /** `index` passe le jeton à la tâche suivante non terminée. */
  pass(index: number): void {
    const size = this.#done.length;
    for (let step = 1; step <= size; step++) {
      const next = (index + step) % size;
      if (this.#done[next]) continue;
      this.#turn = next;
      const waiter = this.#waiters.get(next);
      if (waiter) {
        this.#waiters.delete(next);
        waiter();
      }
      return;
    }
  }

  finish(index: number): void {
    this.#done[index] = true;
    this.pass(index);
  }
}

interface Slot {
  readonly ring: Ring;
  readonly index: number;
}

const slots = new AsyncLocalStorage<Slot>();

/** Vrai si le code courant s'exécute dans une tâche de `runLockstep`. */
export const inLockstep = (): boolean => slots.getStore() !== undefined;

/**
 * Lance `call` (un appel externe de durée imprévisible), passe le jeton à la tâche suivante pendant qu'il est en vol,
 * puis attend son tour pour rendre la main. Hors d'une tâche `runLockstep`, c'est un simple `call()`.
 */
export async function lockstepAround<T>(call: () => Promise<T>): Promise<T> {
  const slot = slots.getStore();
  if (!slot) return call();
  let pending: Promise<T>;
  try {
    pending = call();
  } catch (error) {
    pending = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  slot.ring.pass(slot.index);
  const outcome = await pending.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await slot.ring.acquire(slot.index);
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/**
 * Exécute les tâches en parallèle sous le régime décrit en tête de fichier. Les résultats suivent l'ordre des tâches.
 * Si des tâches échouent, toutes sont menées à leur terme (ou à leur échec) avant que la première erreur (par indice)
 * ne soit relancée.
 */
export async function runLockstep<T>(tasks: readonly (() => Promise<T>)[]): Promise<T[]> {
  const ring = new Ring(tasks.length);
  const settled = await Promise.allSettled(
    tasks.map((task, index) =>
      slots.run({ ring, index }, async () => {
        await ring.acquire(index);
        try {
          return await task();
        } finally {
          ring.finish(index);
        }
      }),
    ),
  );
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value);
}
