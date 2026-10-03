/** Actions d'objet, de vote et d'espionnage dans les interactions : exécutées par les services de formats. */
import { describe, expect, it } from 'vitest';
import {
  type EpochHooks,
  type Id,
  type TickContext,
  ScriptedOutcomeModel,
  absorb,
  createTeam,
  formatContextOf,
  formatOf,
  loadFormatState,
  locationOfCharacter,
  moveCharacter,
  openVote,
  parseSeasonFormat,
  pickUp,
  placeItem,
} from '@ai-reality/engine';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { ADVENTURE_LOCATIONS, adventureWorld, seedWorld } from '@ai-reality/testkit';
import { C, L, go, snapshotOf } from '../helpers/epoch-kit.js';
import { formatScheduler, runNumber } from '../helpers/format-run-kit.js';
import { fullHooks } from '../helpers/interaction-kit.js';
import { ScenarioPolicy, type ScenarioScript } from '../helpers/scenario-policy.js';

const [ALEX, SARAH, LEA, THOMAS] = [C.alexandre, C.sarah, C.lea, C.thomas] as const;

const format = parseSeasonFormat({
  format: 'adventure',
  teams: [],
  schedule: [],
  missions: [],
  items: [
    { slug: 'idol', kind: 'resource', count: 0, placement: 'visible' },
    {
      slug: 'immunity_necklace',
      kind: 'power',
      count: 0,
      placement: 'hidden',
      effects: { on: 'vote_session', nullify_votes_against_holder: true },
      expires: 'after_use',
    },
  ],
});

type Arrange = (ctx: TickContext, def: (slug: string) => Id) => void;

/** Une époque de quatre personnages au salon (sans zones), mise en place par `arrange`, issues scriptées par action. */
async function run(arrange: Arrange, script: ScenarioScript, outcomes: Record<string, string>) {
  const storage = createMemoryStorage();
  const fixture = await seedWorld(storage, adventureWorld({ characters: 4, seed: 'dispatch' }));
  const everyone = [ALEX, SARAH, LEA, THOMAS];
  const hooks: EpochHooks = {
    ...fullHooks(),
    // Les personnages sont placés à la fin du tick 0 : la mise en place des objets se fait au tick 1.
    tick: [
      ...(fullHooks().tick ?? []),
      (ctx) => {
        if (ctx.tick !== 1) return;
        const fs = formatOf(ctx.state);
        arrange(ctx, (slug) => {
          const found = Object.values(fs.itemDefs).find((d) => d.slug === slug);
          if (!found) throw new Error(`définition ${slug} absente`);
          return found.id;
        });
      },
    ],
  };
  const scheduler = formatScheduler(
    storage,
    new ScenarioPolicy({
      destinations: Object.fromEntries(everyone.map((id) => [id, { 0: go(L.salon) }])),
      ...script,
    }),
    { outcome: new ScriptedOutcomeModel(({ option }) => outcomes[option.action]), format, hooks },
  );
  await scheduler.run(runNumber(fixture, 0)).done;
  const snap = await snapshotOf(storage, fixture.world.id, 0);
  const knowledge = await storage.tx((s) => s.knowledge.listByWorld(fixture.world.id));
  const facts = await storage.tx((s) => s.facts.listByWorld(fixture.world.id));
  const fs = await loadFormatState(storage, fixture.season.id);
  return { storage, fixture, snap, knowledge, facts, fs };
}

/** Remet un exemplaire de `slug` à `holderId` pendant la mise en place (événements et faits `holds` compris). */
function grant(ctx: TickContext, defId: Id, holderId: Id): Id {
  const fc = formatContextOf(ctx);
  const locationId = locationOfCharacter(ctx.state, holderId);
  if (!locationId) throw new Error(`${holderId} n'est nulle part`);
  const placed = placeItem(ctx.state, fc, { itemDefId: defId, locationId, hidden: false });
  absorb(ctx, placed);
  absorb(ctx, pickUp(ctx.state, fc, { actorId: holderId, itemId: placed.item.id }));
  return placed.item.id;
}

const learnedFrom = (knowledge: { characterId: string; factId: string }[], factId: string | undefined) =>
  knowledge
    .filter((k) => k.factId === factId)
    .map((k) => k.characterId)
    .sort();

describe('actions d’objet dans les interactions', () => {
  it('pick_up : l’objet change de main, ceux qui entendent le savent', async () => {
    const r = await run(
      (ctx, def) => {
        absorb(
          ctx,
          placeItem(ctx.state, formatContextOf(ctx), { itemDefId: def('idol'), locationId: L.salon, hidden: false }),
        );
      },
      { steps: [{ actor: LEA, tick: 3, action: 'pick_up' }] },
      {},
    );
    const events = r.snap.journal.events;
    const done = events.find((e) => e.type === 'pick_up_done');
    const picked = events.find((e) => e.type === 'item_picked_up' && e.tick === 3);
    expect(picked).toMatchObject({ payload: { to: LEA }, causedByEventId: done?.id });
    const item = Object.values(r.fs.items)[0];
    expect(item).toMatchObject({ holderId: LEA, locationId: null });
    const holds = r.facts.find((f) => f.predicate === 'holds' && f.subjectId === LEA);
    expect(learnedFrom(r.knowledge, holds?.id)).toEqual([ALEX, SARAH, LEA, THOMAS].sort());
  });

  it('steal : un vol non détecté ne laisse aucune connaissance à la victime, un vol détecté si', async () => {
    const arrange: Arrange = (ctx, def) => {
      grant(ctx, def('idol'), SARAH);
    };
    const script = (): ScenarioScript => ({
      steps: [{ actor: ALEX, tick: 3, action: 'steal', targetId: SARAH }],
    });
    const quiet = await run(arrange, script(), { steal: 'undetected' });
    const stolen = quiet.snap.journal.events.find((e) => e.type === 'item_stolen');
    expect(stolen).toMatchObject({ payload: { from: SARAH, to: ALEX, detected: false } });
    const quietHolds = quiet.facts.filter((f) => f.predicate === 'holds' && f.subjectId === ALEX);
    expect(quietHolds).toHaveLength(1);
    expect(learnedFrom(quiet.knowledge, quietHolds[0]?.id)).toEqual([ALEX]);

    const loud = await run(arrange, script(), { steal: 'detected' });
    expect(loud.snap.journal.events.find((e) => e.type === 'item_stolen')).toMatchObject({
      payload: { detected: true },
    });
    const loudHolds = loud.facts.find((f) => f.predicate === 'holds' && f.subjectId === ALEX);
    expect(learnedFrom(loud.knowledge, loudHolds?.id)).toEqual([ALEX, SARAH, LEA, THOMAS].sort());
    expect(loud.snap.journal.events.some((e) => e.type === 'theft_detected')).toBe(true);
  });

  it('give accepté transfère, refusé ne change rien ; hide puis search retrouvent l’objet', async () => {
    const arrange: Arrange = (ctx, def) => {
      grant(ctx, def('idol'), SARAH);
    };
    const given = await run(
      arrange,
      { steps: [{ actor: SARAH, tick: 3, action: 'give', targetId: LEA }] },
      { give: 'accepted' },
    );
    expect(Object.values(given.fs.items)[0]?.holderId).toBe(LEA);
    const refused = await run(
      arrange,
      { steps: [{ actor: SARAH, tick: 3, action: 'give', targetId: LEA }] },
      { give: 'refused' },
    );
    expect(Object.values(refused.fs.items)[0]?.holderId).toBe(SARAH);
    expect(refused.snap.journal.events.some((e) => e.type === 'item_given')).toBe(false);

    const hidden = await run(
      arrange,
      {
        steps: [
          { actor: SARAH, tick: 3, action: 'hide' },
          { actor: ALEX, tick: 6, action: 'search', locationId: L.salon },
        ],
      },
      { hide: 'undetected', search: 'found' },
    );
    const types = hidden.snap.journal.events.map((e) => e.type);
    expect(types).toContain('item_hidden');
    expect(hidden.snap.journal.events.find((e) => e.type === 'item_found')).toMatchObject({ payload: { to: ALEX } });
    expect(Object.values(hidden.fs.items)[0]).toMatchObject({ holderId: ALEX, hidden: false });
  });

  it('use_item : un objet de conseil ne se joue pas hors conseil, un autre objet oui', async () => {
    const r = await run(
      (ctx, def) => {
        grant(ctx, def('immunity_necklace'), LEA);
        grant(ctx, def('idol'), THOMAS);
      },
      {
        steps: [
          { actor: LEA, tick: 3, action: 'use_item' },
          { actor: THOMAS, tick: 3, action: 'use_item' },
        ],
      },
      {},
    );
    const byDef = (slug: string) => Object.values(r.fs.items).find((i) => r.fs.itemDefs[i.itemDefId]?.slug === slug);
    expect(byDef('immunity_necklace')).toMatchObject({ holderId: LEA, state: 'active' });
    // `idol` n'a aucun effet de conseil : use_item générique, événement `item_used`, l'objet reste à son porteur.
    const used = r.snap.journal.events.filter((e) => e.type === 'item_used');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ payload: { by: THOMAS, worked: true } });
    expect(byDef('idol')).toMatchObject({ holderId: THOMAS });
  });

  it('cast_vote : le bulletin est enregistré avec la décision de l’interaction, une seule fois', async () => {
    const r = await run(
      (ctx) => {
        absorb(ctx, openVote(ctx.state, formatContextOf(ctx), { kind: 'elimination' }));
      },
      {
        steps: [
          { actor: ALEX, tick: 3, action: 'cast_vote', targetId: THOMAS },
          { actor: ALEX, tick: 5, action: 'cast_vote', targetId: LEA },
        ],
      },
      {},
    );
    expect(r.fs.votes).toHaveLength(1);
    const ballot = r.fs.votes[0];
    expect(ballot).toMatchObject({ voterId: ALEX, targetId: THOMAS });
    const decision = r.snap.journal.decisions.find((d) => d.id === ballot?.decisionId);
    expect(decision).toMatchObject({ characterId: ALEX, kind: 'action', policy: 'scenario@1' });
    expect(r.snap.journal.events.filter((e) => e.type === 'vote_cast')).toHaveLength(1);
  });
});

describe('spy_camp', () => {
  const arrange: Arrange = (ctx, def) => {
    const fc = formatContextOf(ctx);
    const red = createTeam(ctx.state, fc, {
      slug: 'red',
      name: 'Rouges',
      campLocationId: ADVENTURE_LOCATIONS.campNord,
    });
    const yellow = createTeam(ctx.state, fc, {
      slug: 'yellow',
      name: 'Jaunes',
      campLocationId: ADVENTURE_LOCATIONS.campSud,
    });
    absorb(ctx, red);
    absorb(ctx, yellow);
    for (const [who, team] of [
      [ALEX, red],
      [SARAH, red],
      [LEA, yellow],
      [THOMAS, yellow],
    ] as const) {
      absorb(ctx, moveCharacter(ctx.state, fc, who, team.team.id));
    }
    grant(ctx, def('idol'), SARAH);
  };
  const script: ScenarioScript = {
    destinations: {
      [SARAH]: { 0: go(ADVENTURE_LOCATIONS.campNord) },
      [ALEX]: { 0: go(ADVENTURE_LOCATIONS.campNord) },
      [THOMAS]: { 0: go(L.salon) },
    },
    steps: [{ actor: THOMAS, tick: 3, action: 'spy_camp', locationId: ADVENTURE_LOCATIONS.campNord }],
  };

  it('espion non repéré : il constate ce que porte Sarah', async () => {
    const r = await run(arrange, script, { spy_camp: 'undetected' });
    const holds = r.facts.find((f) => f.predicate === 'holds' && f.subjectId === SARAH);
    expect(learnedFrom(r.knowledge, holds?.id)).toEqual([SARAH, THOMAS].sort());
    expect(r.snap.journal.events.some((e) => e.type === 'camp_spied')).toBe(true);
  });

  it('espion repéré : les occupants du camp savent qu’il est venu', async () => {
    const r = await run(arrange, script, { spy_camp: 'detected' });
    const spied = r.facts.find((f) => f.predicate === 'spied_on' && f.subjectId === THOMAS);
    expect(learnedFrom(r.knowledge, spied?.id)).toEqual([ALEX, SARAH].sort());
    expect(r.snap.journal.events.some((e) => e.type === 'camp_spy_detected')).toBe(true);
  });
});
