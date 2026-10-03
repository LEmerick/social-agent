/** Outils partagés par les tests d'époque : monde, scripts, hooks de test, instantané du journal. */
import {
  type DestinationChoice,
  type EffectInput,
  type EventRecord,
  type Id,
  type StoragePort,
  applyEffect,
  relKey,
} from '@ai-reality/engine';
import { IDS, type WorldFixture, aWorld, seedWorld } from '@ai-reality/testkit';
import { createEpochScheduler } from '../../src/epoch/index.js';
import type { EpochHooks, EpochResult, TickHook } from '../../src/epoch/index.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';

export const C = IDS.characters;
export const L = IDS.locations;
export const Z = IDS.zones;

export const go = (locationId: Id, zoneId: Id | null = null): DestinationChoice => ({ kind: 'go', locationId, zoneId });
export const sleep: DestinationChoice = { kind: 'offstage', reason: 'sleep' };

export type DestinationScript = Record<Id, Record<number, DestinationChoice>>;

/** Journée type de la Maison des Palmiers : quatre personnages, des trajets de 1 et 2 ticks, un trajet à cheval sur le tick 17. */
export const DAY_SCRIPT: DestinationScript = {
  [C.alexandre]: {
    0: go(L.cuisine),
    4: go(L.jardin, Z.banc),
    10: go(L.salon),
    14: go(L.chambres),
    20: go(L.salon),
    25: go(L.cuisine),
  },
  [C.sarah]: { 0: go(L.cuisine), 3: go(L.jardin, Z.piscine), 12: go(L.jardin, Z.banc), 18: sleep, 22: go(L.salon) },
  [C.lea]: { 0: go(L.salon), 2: go(L.cuisine), 9: go(L.jardin), 16: go(L.salon), 26: go(L.cuisine) },
  [C.thomas]: { 0: go(L.chambres), 16: go(L.confessionnal), 21: go(L.chambres), 28: go(L.salon) },
};

export function fixtureWith(mutate?: (fixture: WorldFixture) => WorldFixture): WorldFixture {
  const base = aWorld().build();
  return mutate ? mutate(base) : base;
}

/** À chaque tick, pour chaque scène de deux personnes ou plus : un event, un effet de confiance, une arête de relation. */
export const eventHook: TickHook = (ctx) => {
  const ids = ctx.ids('test');
  for (const view of ctx.scenes) {
    const [first, second] = view.members;
    if (!first || !second) continue;
    const eventId = ids.next();
    const event: EventRecord = {
      id: eventId,
      epochId: ctx.epochId,
      tick: ctx.tick,
      seq: ctx.state.nextEventSeq++,
      type: 'test_event',
      sceneId: view.scene.id,
      interactionId: null,
      locationId: view.scene.locationId,
      payload: { draw: ctx.rng('test', view.scene.id).next() },
      importance: 0.5,
      causedByEventId: null,
      participants: [
        { characterId: first.characterId, role: 'actor' },
        { characterId: second.characterId, role: 'target' },
      ],
    };
    const input: EffectInput = {
      targetKind: 'relationship',
      characterId: first.characterId,
      otherCharacterId: second.characterId,
      dimension: 'trust',
      delta: 1,
      ruleId: 'test',
      ruleVersion: 1,
      reason: null,
    };
    const valueAfter = applyEffect(ctx.state, input);
    ctx.batch.events.push(event);
    ctx.batch.effects.push({ ...input, id: ids.next(), eventId, epochId: ctx.epochId, tick: ctx.tick, valueAfter });
    const edge = ctx.state.relationships[relKey(first.characterId, second.characterId)];
    if (edge) ctx.batch.relationships.push(structuredClone(edge));
  }
};

export const failAt =
  (tick: number): TickHook =>
  (ctx) => {
    if (ctx.tick === tick) throw new Error(`panne injectée au tick ${String(tick)}`);
  };

export function schedulerFor(storage: StoragePort, destinations: DestinationScript, hooks: EpochHooks = {}) {
  return createEpochScheduler({ storage, decision: new ScriptedDecisionPolicy({ destinations }), hooks });
}

export async function playEpoch(
  storage: StoragePort,
  fixture: WorldFixture,
  destinations: DestinationScript,
  hooks: EpochHooks = {},
  number = 0,
): Promise<EpochResult> {
  return schedulerFor(storage, destinations, hooks).run({
    worldId: fixture.world.id,
    seasonNumber: fixture.season.number,
    number,
  }).done;
}

export async function seeded(storage: StoragePort, fixture: WorldFixture = fixtureWith()): Promise<WorldFixture> {
  return seedWorld(storage, fixture);
}

/** Tout ce qu'une époque laisse en base, sous forme comparable. */
export async function snapshotOf(storage: StoragePort, worldId: Id, number: number) {
  return storage.tx(async (s) => {
    const epoch = await s.epochs.findByNumber(worldId, number);
    if (!epoch) throw new Error(`époque ${String(number)} absente`);
    return {
      epoch,
      journal: await s.journal.read(epoch.id),
      states: await s.characterStates.listByEpoch(epoch.id),
      relationships: await s.snapshots.relationships(epoch.id),
      liveRelationships: await s.relationships.listByWorld(worldId),
    };
  });
}
