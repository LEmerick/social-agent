/**
 * Vraisemblance du comportement simulé (M8c) : une époque complète des Palmiers, jouée avec `UtilityDecisionPolicy`
 * et `ProbabilisticOutcomeModel` sur plusieurs graines, ne doit montrer ni faits en double, ni confidences répétées,
 * ni faits « racontés » à qui les a vécus, ni action martelée vers la même cible.
 */
import { describe, expect, it } from 'vitest';
import { AgendaDecisionPolicy, loadSimState, type Id, type SimState } from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { aWorld, seedWorld } from '@ai-reality/testkit';
import { ProbabilisticOutcomeModel, UtilityDecisionPolicy } from '../../src/decision/model/index.js';
import { fullHooks, interactionScheduler, runOf } from '../helpers/interaction-kit.js';
import { snapshotOf } from '../helpers/epoch-kit.js';

const SEEDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
/**
 * Plafond de répétitions d'une même action vers une même cible dans une époque de 32 ticks : sur trente graines, la
 * queue de la distribution s'arrête à 4 (de petites touches : sonder, complimenter), jamais plus ; au-delà, c'est du
 * harcèlement. Ce plafond attrape une régression de l'habituation ; les propositions d'alliance et les répétitions
 * immédiates, qui étaient le vrai défaut, ont leurs tests dédiés plus bas.
 */
const MAX_REPEATS = 4;
/** Actions sans cible de contenu : le bavardage et le repos n'ont pas à être limités de la même façon. */
/** Plusieurs confidences d'affilée (faits différents) forment un seul moment de complicité ; la règle des faits est testée à part. */
const CONSECUTIVE_OK: ReadonlySet<string> = new Set(['share_secret']);
const FREE_REPEATS: ReadonlySet<string> = new Set(['small_talk', 'rest', 'move_to', 'deflect']);

async function playPalmiers(seed: string) {
  const storage = createMemoryStorage();
  const fixture = await seedWorld(storage, aWorld().withSeed(seed).build());
  const decision = new AgendaDecisionPolicy(new UtilityDecisionPolicy());
  await interactionScheduler(storage, decision, new ProbabilisticOutcomeModel(), fullHooks()).run(runOf(fixture)).done;
  const state = await loadSimState(storage, fixture.world.id, fixture.season.number);
  const { journal } = await snapshotOf(storage, fixture.world.id, 0);
  const actionOfEvent = new Map<Id, string>();
  const interactions = new Map(journal.interactions.map((i) => [i.id, i]));
  for (const e of journal.events) {
    const action = e.interactionId === null ? undefined : interactions.get(e.interactionId)?.action;
    if (action) actionOfEvent.set(e.id, action);
  }
  return { state, journal, actionOfEvent };
}

const tripleKey = (f: SimState['facts'][string]): string =>
  JSON.stringify([f.subjectId, f.predicate, f.objectId, f.objectText, f.isTrue]);

describe('vraisemblance : une époque complète des Palmiers', () => {
  const runs = new Map<string, Awaited<ReturnType<typeof playPalmiers>>>();
  const run = async (seed: string) => {
    const known = runs.get(seed);
    if (known) return known;
    const played = await playPalmiers(seed);
    runs.set(seed, played);
    return played;
  };

  it('aucun fait en double (même sujet, prédicat, objet)', async () => {
    for (const seed of SEEDS) {
      const { state } = await run(seed);
      const keys = Object.values(state.facts).map(tripleKey);
      expect(keys.length, seed).toBeGreaterThan(0);
      expect(new Set(keys).size, seed).toBe(keys.length);
    }
  }, 120_000);

  it('jamais deux share_secret du même fait à la même cible', async () => {
    for (const seed of SEEDS) {
      const { state, actionOfEvent } = await run(seed);
      const seen = new Map<string, number>();
      for (const k of Object.values(state.knowledge)) {
        if (k.toldById === null || k.sourceType !== 'told') continue;
        if (actionOfEvent.get(k.viaEventId ?? '') !== 'share_secret') continue;
        const key = `${k.toldById}|${k.characterId}|${k.factId}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      expect(
        [...seen.entries()].filter(([, n]) => n > 1),
        seed,
      ).toEqual([]);
    }
  }, 120_000);

  it('aucun fait « raconté » à son sujet, à son objet ou à un témoin direct de son origine', async () => {
    for (const seed of SEEDS) {
      const { state, actionOfEvent } = await run(seed);
      const actorOf = (eventId: Id | null): string => actionOfEvent.get(eventId ?? '') ?? '';
      const witnessesOf = (factId: Id): Set<Id> =>
        new Set(
          Object.values(state.knowledge)
            .filter((k) => k.factId === factId && k.sourceType === 'witnessed')
            .map((k) => k.characterId),
        );
      const wrong: string[] = [];
      for (const k of Object.values(state.knowledge)) {
        if (k.sourceType !== 'told') continue;
        const fact = state.facts[k.factId];
        if (!fact) continue;
        const confrontation = ['confront', 'accuse'].includes(actorOf(k.viaEventId));
        const concerned = fact.subjectId === k.characterId || fact.objectId === k.characterId;
        const witnessed = witnessesOf(fact.id).has(k.characterId);
        // Un tiers qui confronte l'intéressé lui apprend d'où vient la fuite (provenance) : seule exception, et jamais de
        // la bouche d'un protagoniste du fait.
        const speakerInvolved = fact.subjectId === k.toldById || fact.objectId === k.toldById;
        const provenance = confrontation && !speakerInvolved;
        if ((concerned || witnessed) && !provenance) wrong.push(`${seed} ${fact.predicate} → ${k.characterId}`);
      }
      expect(wrong).toEqual([]);
    }
  }, 120_000);

  /** Interactions d'un acteur vers une cible (hors actions libres), par ordre de tick. */
  const targeted = async (seed: string) => {
    const { journal } = await run(seed);
    return [...journal.interactions]
      .sort((x, y) => x.tickStart - y.tickStart)
      .flatMap((i) => {
        const target = i.participants.find((p) => p.role === 'addressee')?.characterId;
        return target && i.initiatorId && !FREE_REPEATS.has(i.action)
          ? [{ key: `${i.initiatorId}|${i.action}|${target}`, action: i.action, tick: i.tickStart }]
          : [];
      });
  };

  it(`pas plus de ${String(MAX_REPEATS)} fois la même action vers la même cible dans une époque`, async () => {
    const tooMany: string[] = [];
    for (const seed of SEEDS) {
      const counts = new Map<string, number>();
      for (const { key } of await targeted(seed)) counts.set(key, (counts.get(key) ?? 0) + 1);
      for (const [key, n] of counts) if (n > MAX_REPEATS) tooMany.push(`${seed} ${key} ×${String(n)}`);
    }
    expect(tooMany).toEqual([]);
  }, 120_000);

  it('jamais la même action vers la même cible à deux ticks de suite', async () => {
    const streaks: string[] = [];
    for (const seed of SEEDS) {
      const last = new Map<string, number>();
      for (const { key, action, tick } of await targeted(seed)) {
        const prev = last.get(key);
        if (prev !== undefined && tick - prev <= 1 && !CONSECUTIVE_OK.has(action))
          streaks.push(`${seed} ${key} t${String(tick)}`);
        last.set(key, tick);
      }
    }
    expect(streaks).toEqual([]);
  }, 120_000);

  it('une seule proposition d’alliance par cible et par époque', async () => {
    const twice: string[] = [];
    for (const seed of SEEDS) {
      const counts = new Map<string, number>();
      for (const { key, action } of await targeted(seed)) {
        if (action === 'propose_alliance') counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, n] of counts) if (n > 1) twice.push(`${seed} ${key} ×${String(n)}`);
    }
    expect(twice).toEqual([]);
  }, 120_000);
});
