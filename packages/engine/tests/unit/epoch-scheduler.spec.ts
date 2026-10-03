import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import type { EngineEvents } from '../../src/epoch/index.js';
import { createEpochScheduler } from '../../src/epoch/index.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import {
  C,
  DAY_SCRIPT,
  L,
  fixtureWith,
  go,
  playEpoch,
  schedulerFor,
  seeded,
  snapshotOf,
} from '../helpers/epoch-kit.js';

const setup = async () => {
  const storage = createMemoryStorage();
  const fixture = await seeded(storage, fixtureWith());
  return { storage, fixture, run: { worldId: fixture.world.id, seasonNumber: fixture.season.number, number: 0 } };
};

describe('EpochScheduler', () => {
  it("émet les phases dans l'ordre, puis epoch.completed ; une transaction commitée par tick", async () => {
    const { storage, run } = await setup();
    const phases: string[] = [];
    const committed: number[] = [];
    const completed: string[] = [];
    const epoch = schedulerFor(storage, DAY_SCRIPT).run(run);
    epoch.bus.on('phase.started', (e) => phases.push(e.phase));
    epoch.bus.on('tick.committed', (e) => committed.push(e.tick));
    epoch.bus.on('epoch.completed', (e) => completed.push(e.epochId));
    const result = await epoch.done;

    expect(phases).toEqual(['init', 'plan', 'ticks', 'economy', 'memory', 'close']);
    expect(committed).toEqual(Array.from({ length: 33 }, (_, i) => i));
    expect(completed).toEqual([result.epochId]);
    const snap = await storage.tx((s) => s.epochs.findById(result.epochId));
    expect(snap).toMatchObject({ status: 'completed', lastCommittedTick: 32, number: 0 });
  });

  it('publie scene.opened / scene.closed après le commit', async () => {
    const { storage, run } = await setup();
    const opened: string[] = [];
    const closed: Array<number | null> = [];
    const epoch = schedulerFor(storage, { [C.alexandre]: { 0: go(L.cuisine), 5: go(L.salon) } }).run(run);
    epoch.bus.on('scene.opened', (e) => opened.push(e.scene.locationId));
    epoch.bus.on('scene.closed', (e) => closed.push(e.scene.tickEnd));
    await epoch.done;
    // Alexandre seul : cuisine [0,5), transit, salon [6,32) ; les trois autres restent hors-jeu.
    expect(opened).toEqual([L.cuisine, L.salon]);
    expect(closed).toEqual([5, 32]);
  });

  it("appelle les hooks dans l'ordre prévu, avec le bon contexte", async () => {
    const { storage, run } = await setup();
    const calls: string[] = [];
    const seen: Array<Pick<EngineEvents['phase.started'], 'phase'> & { tick: number }> = [];
    const mark = (name: string) => (ctx: { phase: EngineEvents['phase.started']['phase']; tick: number }) => {
      if (ctx.tick <= 1 || ctx.tick >= 32) calls.push(`${name}@${String(ctx.tick)}`);
      seen.push({ phase: ctx.phase, tick: ctx.tick });
    };
    const scheduler = createEpochScheduler({
      storage,
      decision: new ScriptedDecisionPolicy({ destinations: { [C.alexandre]: { 0: go(L.cuisine) } } }),
      hooks: {
        plan: mark('plan'),
        beforeTick: mark('before'),
        tick: [mark('tickA'), mark('tickB')],
        economy: mark('economy'),
        memory: mark('memory'),
        close: mark('close'),
      },
    });
    await scheduler.run(run).done;
    expect(calls).toEqual([
      'plan@0',
      'before@0',
      'tickA@0',
      'tickB@0',
      'before@1',
      'tickA@1',
      'tickB@1',
      'economy@32',
      'memory@32',
      'close@32',
    ]);
  });

  it('le contexte expose les scènes ouvertes après déplacements, des ids et un rng reproductibles', async () => {
    const { storage, run } = await setup();
    const observed: unknown[] = [];
    await schedulerFor(
      storage,
      { [C.alexandre]: { 0: go(L.cuisine) }, [C.sarah]: { 0: go(L.cuisine) } },
      {
        tick: [
          (ctx) => {
            if (ctx.tick !== 0) return;
            observed.push(ctx.scenes.map((v) => v.members.map((m) => m.characterId)));
            observed.push(ctx.ids('x').next() === ctx.ids('x').next(), ctx.ids('x').next() !== ctx.ids('y').next());
            observed.push(
              ctx.rng('a', 1).next() === ctx.rng('a', 1).next(),
              ctx.rng('a').next() !== ctx.rng('b').next(),
            );
          },
        ],
      },
    ).run(run).done;
    expect(observed).toEqual([[[C.alexandre, C.sarah].sort()], false, true, true, true]);
  });

  it("statut eliminated ou paused : hors-jeu toute l'époque, sans consulter la politique", async () => {
    const store = createMemoryStorage();
    const fixture = await seeded(
      store,
      fixtureWith((f) => ({
        ...f,
        characters: f.characters.map((c) =>
          c.id === C.alexandre
            ? { ...c, status: 'eliminated' as const }
            : c.id === C.sarah
              ? { ...c, status: 'paused' as const }
              : c,
        ),
      })),
    );
    await playEpoch(store, fixture, DAY_SCRIPT);
    const { journal } = await snapshotOf(store, fixture.world.id, 0);
    for (const [id, reason] of [
      [C.alexandre, 'eliminated'],
      [C.sarah, 'paused'],
    ] as const) {
      const own = journal.presences.filter((p) => p.characterId === id);
      expect(own.map((p) => [p.kind, p.offstageReason, p.tickStart, p.tickEnd])).toEqual([['offstage', reason, 0, 32]]);
    }
  });

  it('sans route entre deux lieux, le personnage reste sur place', async () => {
    const store = createMemoryStorage();
    const fixture = await seeded(
      store,
      fixtureWith((f) => ({
        ...f,
        routes: f.routes.filter((r) => r.toLocationId !== L.jardin && r.fromLocationId !== L.jardin),
      })),
    );
    // Jardin hors du graphe : on n'y arrive que par apparition directe depuis le hors-jeu.
    await playEpoch(store, fixture, { [C.alexandre]: { 0: go(L.cuisine), 3: go(L.jardin) } });
    const { journal } = await snapshotOf(store, fixture.world.id, 0);
    const own = journal.presences.filter((p) => p.characterId === C.alexandre);
    expect(own.map((p) => [p.kind, p.tickStart, p.tickEnd])).toEqual([['scene', 0, 32]]);
  });

  it('refuse une époque déjà créée, une destination inconnue ; une époque en échec passe à failed', async () => {
    const { storage, fixture, run } = await setup();
    await playEpoch(storage, fixture, {});
    await expect(schedulerFor(storage, {}).run(run).done).rejects.toMatchObject({ code: 'EPOCH_EXISTS' });
    const epochId = (await snapshotOf(storage, fixture.world.id, 0)).epoch.id;
    await expect(schedulerFor(storage, {}).resume(epochId).done).rejects.toMatchObject({ code: 'EPOCH_COMPLETED' });

    const other = await setup();
    await expect(
      schedulerFor(other.storage, { [C.alexandre]: { 0: go('inconnu') } }).run(other.run).done,
    ).rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
    const failed = await snapshotOf(other.storage, other.fixture.world.id, 0);
    expect(failed.epoch.status).toBe('failed');
  });
});
