/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HeuristicOutcomeModel,
  availableOptions,
  journalHash,
  projectedValues,
  replayEffects,
  replayStatuses,
  resolveInteraction,
  settleEpoch,
  stateHash,
  untracedChanges,
} from '../../src/rules/index.js';
import { canonicalJson } from '../../src/core/canonical-json.js';
import { Rng } from '../../src/core/rng.js';
import { simIdFactory } from '../../src/core/sim-ids.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import type { EffectRecord, EventRecord } from '../../src/state/journal.js';
import { AXIS_BOUNDS, BASE_AXES, relKey, type SimState } from '../../src/state/types.js';
import { SLUGS, palmiersState, salonScene } from '../helpers/palmiers.js';

interface Run {
  readonly initial: SimState;
  readonly state: SimState;
  readonly events: EventRecord[];
  readonly effects: EffectRecord[];
  readonly untraced: string[];
}

/** Mini-boucle pure : interactions aléatoires (HeuristicOutcomeModel) et règlement d'époque tous les 16 pas. */
async function simulate(seed: string, steps: number): Promise<Run> {
  const state = palmiersState({ seed });
  // Un personnage proche du seuil pour exercer les transitions de statut.
  state.characters['thomas']!.credits = 28;
  const initial = structuredClone(state);
  const model = new HeuristicOutcomeModel();
  const rng = Rng.derive(seed, 'loop');
  const events: EventRecord[] = [];
  const effects: EffectRecord[] = [];
  const untraced: string[] = [];
  let epochNumber = 0;
  for (let i = 0; i < steps; i++) {
    state.tick = i % 16;
    const ids = simIdFactory(seed, state.world.config, epochNumber, state.tick, `step-${String(i)}`);
    const actorId = rng.pick(SLUGS);
    const ctx = salonScene({ openSlots: ['slot-1'], activityAvailable: true });
    const options = availableOptions(state, actorId, ctx);
    if (options.length > 0) {
      const option = rng.pick(options);
      const { outcome } = await model.resolve({ option, actorId, state, rng });
      const before = structuredClone(state);
      const res = resolveInteraction(state, { option, actorId, outcome, ctx }, ids);
      untraced.push(...untracedChanges(before, state, res.effects));
      events.push(res.event);
      effects.push(...res.effects);
    }
    if (i % 16 === 15) {
      const epoch = { id: `epoch-${String(epochNumber)}`, number: epochNumber };
      const before = structuredClone(state);
      const res = settleEpoch(state, epoch, simIdFactory(seed, state.world.config, epochNumber, 99, 'settle'));
      untraced.push(...untracedChanges(before, state, res.effects));
      events.push(...res.events);
      effects.push(...res.effects);
      epochNumber += 1;
      state.epoch = { id: `epoch-${String(epochNumber)}`, number: epochNumber };
    }
  }
  return { initial, state, events, effects, untraced };
}

const seeds = fc.string({ minLength: 1, maxLength: 12 });
const steps = fc.integer({ min: 5, max: 70 });

/** Projection complète d'un état, en complétant les arêtes jamais touchées par un effet avec leurs valeurs par défaut. */
function projection(s: SimState, reference: SimState): Record<string, number> {
  const withEdges = structuredClone(s);
  for (const e of Object.values(reference.relationships)) {
    withEdges.relationships[relKey(e.sourceId, e.targetId)] ??= defaultEdge(e.sourceId, e.targetId);
  }
  return projectedValues(withEdges);
}

describe('propriétés de la mini-boucle', () => {
  it('rejeu : les seuls effets (et events de statut) reconstruisent les projections', async () => {
    await fc.assert(
      fc.asyncProperty(seeds, steps, async (seed, n) => {
        const run = await simulate(seed, n);
        const replayed = replayStatuses(replayEffects(run.initial, run.effects), run.events);
        expect(projection(replayed, run.state)).toEqual(projectedValues(run.state));
        for (const [id, c] of Object.entries(run.state.characters)) {
          expect(replayed.characters[id]!.status).toBe(c.status);
          expect(replayed.characters[id]!.restrictedSinceEpoch).toBe(c.restrictedSinceEpoch);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('déterminisme : même graine ⇒ même journalHash et même stateHash', async () => {
    await fc.assert(
      fc.asyncProperty(seeds, steps, async (seed, n) => {
        const a = await simulate(seed, n);
        const b = await simulate(seed, n);
        expect(journalHash(a.events)).toBe(journalHash(b.events));
        expect(stateHash(a.state)).toBe(stateHash(b.state));
      }),
      { numRuns: 20 },
    );
  });

  it('déterminisme : des graines différentes donnent des journaux différents', async () => {
    const a = await simulate('graine-a', 40);
    const b = await simulate('graine-b', 40);
    expect(a.events.length).toBeGreaterThan(10);
    expect(journalHash(a.events)).not.toBe(journalHash(b.events));
  });

  it('traçabilité : aucun champ projeté ne change sans effet ; seq consécutifs ; bornes respectées', async () => {
    await fc.assert(
      fc.asyncProperty(seeds, steps, async (seed, n) => {
        const run = await simulate(seed, n);
        expect(run.untraced).toEqual([]);
        expect(run.events.map((e) => e.seq)).toEqual(run.events.map((_, i) => i + 1));
        expect(new Set(run.effects.map((e) => e.eventId)).size).toBeLessThanOrEqual(run.events.length);
        const eventIds = new Set(run.events.map((e) => e.id));
        expect(run.effects.every((e) => eventIds.has(e.eventId))).toBe(true);
        for (const e of Object.values(run.state.relationships)) {
          for (const axis of BASE_AXES) {
            const [min, max] = AXIS_BOUNDS[axis];
            expect(e[axis]).toBeGreaterThanOrEqual(min);
            expect(e[axis]).toBeLessThanOrEqual(max);
          }
        }
        for (const c of Object.values(run.state.characters)) {
          for (const v of Object.values(c.stats)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(100);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('untracedChanges détecte une modification hors effet', async () => {
    const run = await simulate('trace', 10);
    const tampered = structuredClone(run.state);
    tampered.characters['sarah']!.stats.morale += 1;
    expect(untracedChanges(run.state, tampered, [])).toEqual(['char.sarah.stats.morale']);
  });

  it('rejeu vérifié : une valeur journalisée falsifiée est détectée', async () => {
    const run = await simulate('verify', 10);
    const forged = run.effects.map((e, i) => (i === 3 ? { ...e, valueAfter: (e.valueAfter ?? 0) + 1 } : e));
    expect(() => replayEffects(run.initial, forged)).toThrow(/valeur rejouée/);
    expect(() => replayEffects(run.initial, forged, { verify: false })).not.toThrow();
  });
});

describe('hachages', () => {
  it('canonicalJson : indépendant de l’ordre des clés, -0 normalisé, undefined omis', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      canonicalJson({ a: { c: undefined, d: [2, { y: 2, z: 1 }] }, b: 1 }),
    );
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('stateHash et journalHash : stables, sensibles au contenu et à l’ordre', async () => {
    const a = palmiersState();
    const b = palmiersState();
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).toMatch(/^[0-9a-f]{64}$/);
    b.characters['sarah']!.credits += 1;
    expect(stateHash(a)).not.toBe(stateHash(b));
    const run = await simulate('hash', 20);
    const [first, second] = run.events as [EventRecord, EventRecord];
    expect(journalHash([first, second])).not.toBe(journalHash([second, first]));
    expect(journalHash(run.events)).toBe(journalHash(structuredClone(run.events)));
  });
});
