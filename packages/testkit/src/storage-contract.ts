import { afterEach, beforeEach, describe } from 'vitest';
import { charactersContract } from './contract/characters.js';
import { formatsContract } from './contract/formats.js';
import { journalContract } from './contract/journal.js';
import { knowledgeContract } from './contract/knowledge.js';
import { llmCallsContract } from './contract/llm-calls.js';
import { memoriesContract } from './contract/memories.js';
import { referentielContract } from './contract/referentiel.js';
import type { StorageHarness } from './contract/support.js';

export type { StorageHarness } from './contract/support.js';

/**
 * Suite de contrat : la même exécution doit réussir sur `storage-memory` et sur `storage-prisma`.
 * Les adaptateurs fournissent un `StorageHarness` via `factory` ; il est recréé et vidé avant chaque test.
 */
export function storageContract(name: string, factory: () => Promise<StorageHarness>): void {
  describe(`contrat de stockage — ${name}`, () => {
    let harness: StorageHarness;

    beforeEach(async () => {
      harness = await factory();
      await harness.reset();
    });

    afterEach(async () => {
      await harness.close();
    });

    const current = (): StorageHarness => harness;
    referentielContract(current);
    charactersContract(current);
    knowledgeContract(current);
    journalContract(current);
    llmCallsContract(current);
    memoriesContract(current);
    formatsContract(current);
  });
}
