import fc from 'fast-check';
import { describe, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import type { DestinationChoice, Id, RouteEdge } from '@ai-reality/engine';
import { shortestRoute } from '../../src/world/shortest-route.js';
import { C, L, Z, fixtureWith, go, playEpoch, seeded, snapshotOf } from '../helpers/epoch-kit.js';
import type { DestinationScript } from '../helpers/epoch-kit.js';

const LOCATIONS = Object.values(L);
const CHARACTERS = Object.values(C);

const choiceArb: fc.Arbitrary<DestinationChoice> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<DestinationChoice>({ kind: 'stay' }) },
  { weight: 6, arbitrary: fc.constantFrom(...LOCATIONS).map((l) => go(l)) },
  { weight: 2, arbitrary: fc.constantFrom(go(L.jardin, Z.banc), go(L.jardin, Z.piscine)) },
  { weight: 1, arbitrary: fc.constant<DestinationChoice>({ kind: 'offstage', reason: 'sleep' }) },
);

const worldArb = fc.record({
  ticksPerEpoch: fc.integer({ min: 3, max: 24 }),
  routes: fc.array(
    fc.record({
      fromLocationId: fc.constantFrom(...LOCATIONS),
      toLocationId: fc.constantFrom(...LOCATIONS),
      travelTicks: fc.integer({ min: 1, max: 5 }),
    }),
    { maxLength: 14 },
  ),
  characters: fc.array(
    fc.record({
      id: fc.constantFrom(...CHARACTERS),
      status: fc.constantFrom('active', 'active', 'active', 'paused', 'eliminated', 'restricted'),
      choices: fc.dictionary(fc.integer({ min: 0, max: 23 }).map(String), choiceArb, { maxKeys: 10 }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
});

describe('propriétés de la timeline (mondes et agendas aléatoires)', () => {
  it('un segment par personnage et par tick, sans trou, trajets exacts, scènes fermées sans présence ouverte', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async (world) => {
        const routes: RouteEdge[] = [];
        for (const r of world.routes) {
          if (
            r.fromLocationId !== r.toLocationId &&
            !routes.some((o) => o.fromLocationId === r.fromLocationId && o.toLocationId === r.toLocationId)
          )
            routes.push(r);
        }
        const chosen = new Map(world.characters.map((c) => [c.id, c]));
        const storage = createMemoryStorage();
        const fixture = await seeded(
          storage,
          fixtureWith((f) => ({
            ...f,
            world: { ...f.world, config: { ...f.world.config, ticksPerEpoch: world.ticksPerEpoch } },
            routes,
            characters: f.characters
              .filter((c) => chosen.has(c.id))
              .map((c) => ({ ...c, status: chosen.get(c.id)?.status ?? 'active' })),
            goals: [],
            relationships: [],
            facts: [],
            knowledge: [],
          })),
        );
        const script: DestinationScript = {};
        for (const c of world.characters) {
          script[c.id] = Object.fromEntries(Object.entries(c.choices).map(([t, v]) => [Number(t), v]));
        }
        await playEpoch(storage, fixture, script);
        const { journal } = await snapshotOf(storage, fixture.world.id, 0);
        const N = world.ticksPerEpoch;

        // Rien de resté ouvert.
        if (journal.presences.some((p) => p.tickEnd === null)) throw new Error('présence encore ouverte');
        if (journal.scenes.some((s) => s.tickEnd === null)) throw new Error('scène encore ouverte');

        const sceneById = new Map(journal.scenes.map((s) => [s.id, s]));
        for (const c of fixture.characters) {
          const own = journal.presences.filter((p) => p.characterId === c.id);
          // Exactement un segment à chaque tick de [0, N).
          for (let tick = 0; tick < N; tick++) {
            const covering = own.filter((p) => p.tickStart <= tick && tick < (p.tickEnd ?? N));
            if (covering.length !== 1)
              throw new Error(`${c.slug} : ${String(covering.length)} segments au tick ${String(tick)}`);
          }
          // Aucun trou, ni débordement.
          let cursor = 0;
          for (const p of own) {
            if (p.tickStart !== cursor) throw new Error(`${c.slug} : trou ou chevauchement en ${String(cursor)}`);
            cursor = p.tickEnd ?? N;
          }
          if (cursor !== N) throw new Error(`${c.slug} : timeline finit en ${String(cursor)}`);

          // Un trajet dure exactement travelTicks (tronqué par la fin d'époque).
          for (const p of own.filter((q) => q.kind === 'transit')) {
            const plan = shortestRoute({ routes }, p.fromLocationId as Id, p.toLocationId as Id);
            const expected = Math.min(plan?.travelTicks ?? -1, N - p.tickStart);
            if ((p.tickEnd ?? N) - p.tickStart !== expected)
              throw new Error(
                `${c.slug} : trajet de ${String((p.tickEnd ?? N) - p.tickStart)} ticks, attendu ${String(expected)}`,
              );
          }

          // Statut forcé : hors-jeu toute l'époque.
          if (
            (c.status === 'paused' || c.status === 'eliminated') &&
            !(own.length === 1 && own[0]?.kind === 'offstage')
          ) {
            throw new Error(`${c.slug} devrait rester hors-jeu`);
          }
        }

        // Une scène fermée n'a plus de présence : toute présence de scène est incluse dans la plage de sa scène.
        for (const p of journal.presences.filter((q) => q.kind === 'scene')) {
          const scene = sceneById.get(p.sceneId ?? '');
          if (!scene || scene.tickEnd === null || p.tickStart < scene.tickStart || (p.tickEnd ?? N) > scene.tickEnd) {
            throw new Error('présence hors de la plage de sa scène');
          }
        }
        // Une scène n'est jamais vide pendant son existence : à chaque tick de sa plage, au moins un membre.
        for (const scene of journal.scenes) {
          for (let tick = scene.tickStart; tick < (scene.tickEnd ?? N); tick++) {
            const members = journal.presences.filter(
              (p) => p.sceneId === scene.id && p.tickStart <= tick && tick < (p.tickEnd ?? N),
            );
            if (members.length === 0) throw new Error(`scène vide au tick ${String(tick)}`);
          }
        }
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});
