import { expect } from 'vitest';
import { DomainError, type StoragePort } from '@ai-reality/engine';

export interface StorageHarness {
  storage: StoragePort;
  /** Remet la base dans un état vide entre deux tests. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Accès à l'harnais courant : il est recréé avant chaque test. */
export type HarnessRef = () => StorageHarness;

/** Vérifie qu'une promesse échoue avec une `DomainError` du code attendu. */
export async function expectCode(
  promise: Promise<unknown>,
  code: 'DUPLICATE' | 'NOT_FOUND' | 'PRESENCE_OVERLAP' | 'CONSTRAINT_VIOLATION',
): Promise<void> {
  const failure = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(failure).toBeInstanceOf(DomainError);
  expect((failure as DomainError).code).toBe(code);
}
