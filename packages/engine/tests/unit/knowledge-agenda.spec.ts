import { describe, expect, it } from 'vitest';
import {
  AgendaDecisionPolicy,
  type DecisionPolicy,
  Rng,
  availableOptions,
  betrayalEffects,
  createFact,
  deferredTell,
  identifyTraitor,
  refreshSightings,
  simIdFactory,
  witness,
} from '@ai-reality/engine';
import { IDS, aSimState } from '@ai-reality/testkit';
import { acquaintanceFor, promoteAcquaintance } from '../../src/resolution/acquaintance.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { runChain } from '../helpers/chain-scenario.js';
import { option } from '../helpers/knowledge-kit.js';

const { alexandre, sarah, lea, thomas } = IDS.characters;
const { jardin, cuisine, salon } = IDS.locations;

/** Le moment où Sarah vient d'apprendre F1 avec Alexandre : son intention de le raconter à Léa est formée. */
function sarahJustLearned() {
  const state = aSimState();
  const ids = simIdFactory(state.world.seed, state.world.config, 0, 3, 'agenda');
  const fact = createFact(
    state,
    { subjectId: alexandre, predicate: 'a proposé une alliance à', objectId: sarah, sensitivity: 2 },
    ids,
  );
  const witnesses = [alexandre, sarah].map((characterId) => ({ characterId, perception: 'hears' as const }));
  witness(state, { factIds: [fact.id], witnesses, viaEventId: null, epoch: 0, tick: 3 }, ids);
  return { state, fact };
}

const at = (locationId: string) => ({ kind: 'at' as const, locationId, zoneId: null });
const unusedBase: DecisionPolicy = {
  choose: () => Promise.resolve({ chosen: null, rngDraw: null, policy: 'base@1' }),
  chooseDestination: () => Promise.resolve({ kind: 'go', locationId: salon, zoneId: null }),
};

describe('niveaux de connaissance (acquaintance@1)', () => {
  const edge = (patch: Partial<ReturnType<typeof defaultEdge>>) => ({ ...defaultEdge(sarah, lea), ...patch });

  it('met → acquainted → close selon le nombre d’interactions, l’affection et la confiance', () => {
    expect(acquaintanceFor(edge({ interactionCount: 0 }))).toBe('known_of');
    expect(acquaintanceFor(edge({ interactionCount: 1 }))).toBe('met');
    expect(acquaintanceFor(edge({ interactionCount: 3 }))).toBe('acquainted');
    // Beaucoup d'interactions mais ni affection ni confiance : on reste de simples connaissances.
    expect(acquaintanceFor(edge({ interactionCount: 20 }))).toBe('acquainted');
    expect(acquaintanceFor(edge({ interactionCount: 7, affection: 60, trust: 90 }))).toBe('acquainted');
    expect(acquaintanceFor(edge({ interactionCount: 8, affection: 20, trust: 50 }))).toBe('close');
    expect(acquaintanceFor(edge({ interactionCount: 8, affection: 19, trust: 90 }))).toBe('acquainted');
  });

  it('ne redescend jamais', () => {
    const e = edge({ interactionCount: 8, affection: 40, trust: 70, acquaintance: 'close' });
    e.affection = -50;
    e.trust = 0;
    promoteAcquaintance(e);
    expect(e.acquaintance).toBe('close');
    const rising = edge({ interactionCount: 3, acquaintance: 'met' });
    promoteAcquaintance(rising);
    expect(rising.acquaintance).toBe('acquainted');
  });
});

describe('intentions différées et agenda', () => {
  it('l’intention retient le lieu où l’apprenant voit l’allié, sinon rien', () => {
    const { state, fact } = sarahJustLearned();
    const sarahNode = state.characters[sarah];
    if (sarahNode) sarahNode.agenda = [];
    state.positions[sarah] = at(jardin);
    state.positions[lea] = at(cuisine);
    expect(deferredTell(state, sarah, fact, null)?.locationId).toBeNull();
    state.positions[lea] = at(jardin);
    expect(deferredTell(state, sarah, fact, null)?.locationId).toBe(jardin);
  });

  it('refreshSightings met à jour le dernier lieu connu quand la cible est dans la scène', () => {
    const { state, fact } = sarahJustLearned();
    expect(state.characters[sarah]?.agenda[0]).toMatchObject({ targetId: lea, factId: fact.id });
    const members = [sarah, lea].map((characterId) => ({ characterId, zoneId: null, role: 'participant' as const }));
    const scene = {
      id: 's',
      epochId: 'e',
      locationId: salon,
      zoneId: null,
      kind: 'free' as const,
      tickStart: 0,
      tickEnd: null,
    };
    refreshSightings(state, [{ scene, members }]);
    expect(state.characters[sarah]?.agenda[0]?.locationId).toBe(salon);
    // Léa n'a pas d'intention vers Sarah : rien ne change pour elle.
    expect(state.characters[lea]?.agenda).toEqual([]);
  });

  it('AgendaDecisionPolicy : l’option share_secret de l’intention passe avant le choix de base', async () => {
    const { state, fact } = sarahJustLearned();
    const options = [
      option('small_talk', lea),
      option('share_secret', lea, fact.id),
      option('share_secret', thomas, fact.id),
    ];
    const policy = new AgendaDecisionPolicy(unusedBase);
    const result = await policy.choose({ actorId: sarah, state, options, rng: Rng.derive('x') });
    expect(result).toMatchObject({ chosen: options[1], policy: 'agenda@1', rngDraw: null });
    // Sans option correspondante (Léa absente de la scène), la politique de base reprend.
    const absent = await policy.choose({
      actorId: sarah,
      state,
      options: [options[0] ?? option('x', null)],
      rng: Rng.derive('x'),
    });
    expect(absent.policy).toBe('base@1');
  });

  it('AgendaDecisionPolicy stochastique : tire contre la priorité, tracé dans rngDraw', async () => {
    const { state, fact } = sarahJustLearned();
    const options = [option('share_secret', lea, fact.id)];
    const never = new AgendaDecisionPolicy(unusedBase, { stochastic: true, minPriority: 0 });
    const draws = await Promise.all(
      Array.from({ length: 40 }, (_, i) => never.choose({ actorId: sarah, state, options, rng: Rng.derive('d', i) })),
    );
    const taken = draws.filter((d) => d.policy === 'agenda@1');
    expect(taken.length).toBeGreaterThan(5);
    expect(taken.length).toBeLessThan(40);
    expect(
      taken.every((d) => d.rngDraw !== null && d.rngDraw < (state.characters[sarah]?.agenda[0]?.priority ?? 0)),
    ).toBe(true);
    const strict = new AgendaDecisionPolicy(unusedBase, { minPriority: 0.99 });
    expect((await strict.choose({ actorId: sarah, state, options, rng: Rng.derive('x') })).policy).toBe('base@1');
  });

  it('AgendaDecisionPolicy : la destination suit le dernier lieu connu de la cible', async () => {
    const { state } = sarahJustLearned();
    const rng = Rng.derive('x');
    const policy = new AgendaDecisionPolicy(unusedBase);
    state.positions[sarah] = at(jardin);
    const agenda = state.characters[sarah]?.agenda ?? [];
    // Lieu inconnu : politique de base.
    expect(await policy.chooseDestination({ actorId: sarah, state, rng })).toEqual({
      kind: 'go',
      locationId: salon,
      zoneId: null,
    });
    // Dernier lieu connu : la cuisine.
    agenda[0] = { ...(agenda[0] ?? defaultIntention()), locationId: cuisine };
    expect(await policy.chooseDestination({ actorId: sarah, state, rng })).toEqual({
      kind: 'go',
      locationId: cuisine,
      zoneId: null,
    });
    // Sur place avec la cible : on reste ; sur place sans elle : le lieu est périmé, la base reprend.
    state.positions[sarah] = at(cuisine);
    state.positions[lea] = at(cuisine);
    expect(await policy.chooseDestination({ actorId: sarah, state, rng })).toEqual({ kind: 'stay' });
    state.positions[lea] = at(salon);
    expect((await policy.chooseDestination({ actorId: sarah, state, rng })).kind).toBe('go');
  });
});

const defaultIntention = () => ({
  kind: 'tell' as const,
  targetId: lea,
  goal: null,
  factId: null,
  locationId: null,
  priority: 0.5,
});

describe('confrontation au sujet d’un fait', () => {
  it('le traître est le premier à avoir raconté le fait ; le retournement vise cette alliance', () => {
    const { state, fact } = runChain();
    // Alexandre allié de Sarah (comme après `propose_alliance:accepted`).
    state.relationships[`${alexandre}>${sarah}`] = { ...defaultEdge(alexandre, sarah), alliance: 20, trust: 35 };
    expect(identifyTraitor(state, thomas, alexandre, fact.id)).toBe(sarah);
    const betrayal = betrayalEffects(state, thomas, alexandre, fact.id, 'escalated');
    expect(betrayal?.traitorId).toBe(sarah);
    const by = (dimension: string, from: string) =>
      betrayal?.effects.find((e) => e.dimension === dimension && e.characterId === from)?.delta;
    expect(by('alliance', alexandre)).toBe(-20);
    expect(by('rivalry', alexandre)).toBe(50);
    expect(betrayal?.effects.every((e) => e.ruleId === 'confront_betrayal' && e.ruleVersion === 1)).toBe(true);
  });

  it('rien n’est établi si la cible esquive, si le fait ne la concerne pas ou si elle n’avait aucun lien avec le traître', () => {
    const { state, fact } = runChain();
    state.relationships[`${alexandre}>${sarah}`] = { ...defaultEdge(alexandre, sarah), alliance: 20 };
    expect(betrayalEffects(state, thomas, alexandre, fact.id, 'deflected')).toBeNull();
    expect(betrayalEffects(state, thomas, alexandre, fact.id, 'backfired')).toBeNull();
    // Le fait ne concerne pas Léa.
    expect(identifyTraitor(state, thomas, lea, fact.id)).toBeNull();
    // Aucun lien (alliance 0, confiance 30 par défaut) entre Alexandre et Sarah.
    state.relationships[`${alexandre}>${sarah}`] = defaultEdge(alexandre, sarah);
    expect(identifyTraitor(state, thomas, alexandre, fact.id)).toBeNull();
    // L'accusateur qui a assisté à la scène n'accuse personne.
    expect(identifyTraitor(state, sarah, alexandre, fact.id)).toBeNull();
  });

  it('confront / accuse proposent aussi les faits connus qui concernent la cible', () => {
    const { state, fact } = runChain();
    const scene = {
      members: [alexandre, thomas].map((characterId) => ({ characterId, locationId: jardin, zoneId: null })),
    };
    const options = availableOptions(state, thomas, scene).filter((o) => o.action === 'confront');
    expect(options.map((o) => o.factId)).toEqual([null, fact.id]);
    // Un fait que Thomas ne connaît pas n'est jamais proposé.
    const blank = aSimState();
    expect(
      availableOptions(blank, thomas, scene)
        .filter((o) => o.action === 'confront')
        .map((o) => o.factId),
    ).toEqual([null]);
  });
});
