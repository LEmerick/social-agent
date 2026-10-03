import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import {
  type Moment,
  arcIdOf,
  buildArcsFrom,
  candidatesOf,
  collectDigest,
  memoryNarrativeStorage,
  selectMoments,
} from '../src/index.js';
import { C, EVT, seedBetrayal } from './helpers/betrayal.js';

async function digest() {
  const sim = createMemoryStorage();
  const { epochId } = await seedBetrayal(sim);
  return collectDigest(memoryNarrativeStorage(sim), epochId);
}

const ids = (moments: readonly Moment[]): string[] => moments.map((m) => m.eventId);
const screenTime = (moments: readonly Moment[], who: string): number =>
  moments.filter((m) => m.participantIds.includes(who)).reduce((s, m) => s + m.seconds, 0);

describe('collecte', () => {
  it('rassemble events, effets, diff d’état et personnages joueurs', async () => {
    const d = await digest();
    expect(d.epochNumber).toBe(14);
    expect(d.events).toHaveLength(6);
    expect(d.stateDiff.find((x) => x.dimension === 'alliance' && x.characterId === C.sarah)).toMatchObject({
      delta: -40,
      valueAfter: 0,
    });
    expect(d.causes[EVT.betrayal]).toBe(EVT.rumor);
    expect(d.playerCharacterIds).toEqual([C.lea]);
  });

  it('refuse une époque non terminée', async () => {
    const sim = createMemoryStorage();
    const { epochId } = await seedBetrayal(sim, 'running');
    await expect(collectDigest(memoryNarrativeStorage(sim), epochId)).rejects.toThrow(/pas terminée/);
  });
});

describe('sélection', () => {
  it('retient les plus importants dans la durée visée, en ignorant le bruit', async () => {
    const d = await digest();
    const moments = selectMoments(d, { targetSeconds: 60, minScreenTimePerPlayer: 0 });
    expect(ids(moments)).toEqual([EVT.proposal, EVT.rumor, EVT.betrayal]);
    expect(moments.reduce((s, m) => s + m.seconds, 0)).toBeLessThanOrEqual(60);
  });

  it('garantit le temps d’écran minimal d’un personnage joueur, là où l’importance seule l’oublierait', async () => {
    const d = await digest();
    const without = selectMoments(d, { targetSeconds: 40, minScreenTimePerPlayer: 0 });
    expect(screenTime(without, C.lea)).toBeLessThan(20);

    const withQuota = selectMoments(d, { targetSeconds: 40, minScreenTimePerPlayer: 20, playerCharacterIds: [C.lea] });
    expect(screenTime(withQuota, C.lea)).toBeGreaterThanOrEqual(20);
    expect(withQuota.reduce((s, m) => s + m.seconds, 0)).toBeLessThanOrEqual(40);
  });

  it('le quota reste dans la durée visée et prend les moments les plus importants du joueur d’abord', async () => {
    const d = await digest();
    const moments = selectMoments(d, {
      targetSeconds: 30,
      minScreenTimePerPlayer: 1000,
      playerCharacterIds: [C.alexandre],
    });
    expect(moments.reduce((s, m) => s + m.seconds, 0)).toBeLessThanOrEqual(30);
    expect(ids(moments)).toContain(EVT.betrayal);
  });

  it('est déterministe, quel que soit l’ordre des events en entrée', async () => {
    const d = await digest();
    const opts = { targetSeconds: 70, minScreenTimePerPlayer: 15, playerCharacterIds: [C.thomas, C.lea] };
    const a = selectMoments(d, opts);
    const b = selectMoments({ ...d, events: [...d.events].reverse() }, opts);
    expect(ids(b)).toEqual(ids(a));
  });

  it('chaque moment porte sa chaîne d’ancêtres et ses répliques', async () => {
    const d = await digest();
    const betrayal = candidatesOf(d).find((m) => m.eventId === EVT.betrayal);
    expect(betrayal?.ancestors).toEqual([EVT.rumor, EVT.confidence, EVT.proposal]);
    expect(candidatesOf(d).find((m) => m.eventId === EVT.proposal)?.utteranceIds).toHaveLength(4);
  });
});

describe('arcs', () => {
  it('regroupe la chaîne caused_by en un seul arc et isole les événements sans lien', async () => {
    const d = await digest();
    const moments = selectMoments(d, { targetSeconds: 1000, minScreenTimePerPlayer: 0, minImportance: 0 });
    const arcs = buildArcsFrom(d.worldId, moments);
    expect(arcs).toHaveLength(3);
    expect(arcs[0]).toMatchObject({
      id: arcIdOf(EVT.proposal),
      rootEventId: EVT.proposal,
      eventIds: [EVT.proposal, EVT.confidence, EVT.rumor, EVT.betrayal],
      importance: 0.95,
      status: 'open',
    });
    expect(arcs[0]?.characterIds).toEqual([C.alexandre, C.sarah, C.lea, C.thomas].sort());
    expect(arcs.slice(1).map((a) => a.eventIds)).toEqual(expect.arrayContaining([[EVT.lonely], [EVT.chatter]]));
  });

  it('une cause écartée de la sélection ne casse pas la chaîne', async () => {
    const d = await digest();
    const all = candidatesOf(d);
    const picked = all.filter((m) => m.eventId === EVT.proposal || m.eventId === EVT.betrayal);
    const arcs = buildArcsFrom(d.worldId, picked);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.eventIds).toEqual([EVT.proposal, EVT.betrayal]);
  });

  it('un moment qui prolonge un arc ouvert le reprend, avec son histoire', async () => {
    const d = await digest();
    const all = candidatesOf(d);
    const first = buildArcsFrom(
      d.worldId,
      all.filter((m) => m.eventId === EVT.proposal),
    )[0];
    expect(first).toBeDefined();
    if (!first) return;
    const later = {
      ...(all.find((m) => m.eventId === EVT.betrayal) as Moment),
      continuesArcId: first.id,
      ancestors: [],
    };
    const arcs = buildArcsFrom(d.worldId, [later], [first]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ id: first.id, rootEventId: EVT.proposal, eventIds: [EVT.proposal, EVT.betrayal] });
  });
});
