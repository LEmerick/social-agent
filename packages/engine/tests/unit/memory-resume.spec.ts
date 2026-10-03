import { createMemoryStorage } from '@ai-reality/storage-memory';
import { FakeEmbedding, FakeLLM } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { agentMemoryHook, eventsFromStorage } from '../../src/agent/hooks.js';
import { createAgentRuntime } from '../../src/agent/runtime.js';
import type { TickHook } from '../../src/epoch/index.js';
import { createMemoryService } from '../../src/memory/service.js';
import type { StoragePort } from '../../src/ports/storage.js';
import { C, DAY_SCRIPT, eventHook, fixtureWith, schedulerFor, seeded, snapshotOf } from '../helpers/epoch-kit.js';
import { personaOf } from '../helpers/llm-kit.js';
import { epochId, seedEpochs } from '../helpers/memory-kit.js';

const CHARACTERS = Object.values(C);

const memoriesOf = async (storage: StoragePort) =>
  storage.tx(async (s) => (await Promise.all(CHARACTERS.map((c) => s.memories.listByCharacter(c)))).flat());

const memoryHook = (storage: StoragePort): TickHook =>
  agentMemoryHook(
    createAgentRuntime({
      llm: new FakeLLM({ rules: [{ purpose: 'reflect', replies: [{ beliefs: [], goalUpdates: [] }] }] }),
      persona: personaOf,
    }),
    createMemoryService(storage, new FakeEmbedding()),
    eventsFromStorage(storage),
  );

describe('phase mémoire idempotente à la reprise', () => {
  it('panne pendant la clôture puis resume : mêmes souvenirs qu’une exécution continue, sans doublon', async () => {
    const fixture = fixtureWith();
    const run = { worldId: fixture.world.id, seasonNumber: fixture.season.number, number: 0 };

    const reference = createMemoryStorage();
    await seeded(reference, fixture);
    await schedulerFor(reference, DAY_SCRIPT, { tick: [eventHook], memory: memoryHook(reference) }).run(run).done;
    const expected = await memoriesOf(reference);
    expect(expected.length).toBeGreaterThan(4);

    const storage = createMemoryStorage();
    await seeded(storage, fixture);
    let tripped = false;
    const failOnce: TickHook = () => {
      if (tripped) return;
      tripped = true;
      throw new Error('panne pendant la clôture');
    };
    const crashing = schedulerFor(storage, DAY_SCRIPT, {
      tick: [eventHook],
      memory: memoryHook(storage),
      close: failOnce,
    });
    await expect(crashing.run(run).done).rejects.toThrow('panne pendant la clôture');
    const afterCrash = await memoriesOf(storage);
    expect(afterCrash).toHaveLength(expected.length); // la phase mémoire avait déjà écrit ses souvenirs

    const failed = await snapshotOf(storage, fixture.world.id, 0);
    expect(failed.epoch).toMatchObject({ status: 'failed' });
    await schedulerFor(storage, DAY_SCRIPT, { tick: [eventHook], memory: memoryHook(storage), close: failOnce }).resume(
      failed.epoch.id,
    ).done;

    const resumed = await memoriesOf(storage);
    expect(resumed.map((m) => m.id)).toEqual(expected.map((m) => m.id));
    expect(new Set(resumed.map((m) => m.id)).size).toBe(resumed.length);
    expect((await snapshotOf(storage, fixture.world.id, 0)).epoch.status).toBe('completed');
  }, 60_000);

  it('MemoryService.record ignore les brouillons déjà écrits et ne renvoie que les nouveaux', async () => {
    const storage = createMemoryStorage();
    await seedEpochs(storage, 0);
    const service = createMemoryService(storage, new FakeEmbedding());
    const draft = (n: number) => ({
      id: `00000000-0000-4000-8000-00000000009${String(n)}`,
      characterId: C.sarah,
      eventId: null,
      epochId: epochId(0),
      kind: 'episodic' as const,
      summary: `souvenir ${String(n)}`,
      emotion: null,
      salience: 0.5,
      aboutCharacterIds: [],
    });
    expect(await service.record(C.sarah, [draft(1), draft(2)])).toHaveLength(2);
    expect((await service.record(C.sarah, [draft(1), draft(3)])).map((r) => r.summary)).toEqual(['souvenir 3']);
    expect(await service.record(C.sarah, [draft(1), draft(3)])).toEqual([]);
    expect(await storage.tx((s) => s.memories.listByCharacter(C.sarah))).toHaveLength(3);
  });
});
