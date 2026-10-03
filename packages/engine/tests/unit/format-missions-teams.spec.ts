import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { simIdFactory } from '../../src/core/sim-ids.js';
import { of } from '../../src/knowledge/index.js';
import {
  ADVENTURE_FORMAT,
  type Condition,
  VILLA_FORMAT,
  activeMissions,
  announceScheduled,
  assignMission,
  createFormatService,
  createTeam,
  dueEvents,
  evaluateMissions,
  expandSchedule,
  findItem,
  fireScheduled,
  formatOf,
  mergeTeams,
  membersOf,
  moveCharacter,
  parseSeasonFormat,
  placeItem,
  resolveMissions,
  teamOf,
} from '../../src/formats/index.js';
import { A, DEF, L, LEA, S, T, formatKit, must, hears, missionDef } from '../helpers/format-kit.js';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { IDS, seedWorld } from '@ai-reality/testkit';

const MISSION = '01960000-0000-7000-8000-000000008201';
const SUPPLY = '01960000-0000-7000-8000-000000008202';

const findNecklaceHolder: Condition = {
  all: [
    { knows: { who: '$self', fact: { predicate: 'holds', object: 'item_def:immunity_necklace' }, minConfidence: 0.7 } },
    { before: { epoch: '$deadline' } },
  ],
};

function withMission(over: Partial<Parameters<typeof missionDef>[0]> = {}) {
  const kit = formatKit(3, 8);
  const def = missionDef({
    id: MISSION,
    slug: 'find_necklace_holder',
    objective: findNecklaceHolder,
    reward: { credits: 15, stats: { morale: 5 } },
    penalty: { scores: { drama: 2 } },
    deadlineEpochOffset: 2,
    ...over,
  });
  formatOf(kit.state).missionDefs[def.id] = def;
  return { kit, def };
}

describe('MissionService : attribution', () => {
  it('crée l’attribution (échéance = époque + délai), l’événement, l’objectif de saison et le briefing', () => {
    const { kit, def } = withMission();
    const out = assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    expect(out.assignment).toMatchObject({
      missionDefId: def.id,
      characterId: T,
      teamId: null,
      deadlineEpoch: 5,
      status: 'active',
    });
    expect(out.assignment.assignedEventId).toBe(out.events[0]?.id);
    expect(out.events[0]).toMatchObject({ type: 'mission_assigned', payload: { secrecy: 'secret', deadlineEpoch: 5 } });
    expect(out.goals).toEqual([
      {
        characterId: T,
        goal: expect.objectContaining({
          id: out.assignment.id,
          origin: 'season',
          status: 'open',
          description: def.briefing,
        }),
      },
    ]);
    expect(kit.state.characters[T]?.goals.some((g) => g.id === out.assignment.id)).toBe(true);
    expect(activeMissions(kit.state, T)).toEqual([out.assignment]);
    expect(activeMissions(kit.state, S)).toEqual([]);
  });

  it('une mission secrète n’est connue que de son titulaire ; une mission publique de tous', () => {
    const { kit, def } = withMission();
    assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    const knowers = (who: string) => of(kit.state, who).filter((k) => k.fact.predicate === 'mission');
    expect(knowers(T)).toHaveLength(1);
    expect(knowers(T)[0]?.fact.sensitivity).toBe(3);
    for (const other of [A, S, LEA]) expect(knowers(other)).toEqual([]);

    const pub = missionDef({ id: SUPPLY, slug: 'public', secrecy: 'public', objective: { epoch_gte: 99 } });
    formatOf(kit.state).missionDefs[pub.id] = pub;
    assignMission(kit.state, kit.fc, { missionDefId: pub.id, to: { characterId: A } });
    for (const who of [A, S, LEA, T]) expect(knowers(who).some((k) => k.fact.sensitivity === 0)).toBe(true);
  });

  it('une mission d’équipe concerne tous les membres', () => {
    const { kit } = withMission();
    const team = createTeam(kit.state, kit.fc, { slug: 'red', name: 'Rouges' }).team;
    moveCharacter(kit.state, kit.fc, A, team.id);
    moveCharacter(kit.state, kit.fc, S, team.id);
    const def = missionDef({
      id: SUPPLY,
      slug: 'supply',
      scope: 'team',
      secrecy: 'private',
      objective: { holds: { who: '$team', item: 'food_ration', count: { gte: 2 } } },
      reward: { stats: { morale: 10 } },
    });
    formatOf(kit.state).missionDefs[def.id] = def;
    const out = assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { teamId: team.id } });
    expect(out.goals.map((g) => g.characterId).sort()).toEqual([A, S].sort());
    expect(activeMissions(kit.state, A)).toHaveLength(1);
    expect(activeMissions(kit.state, T)).toEqual([]);
    expect(of(kit.state, S).some((k) => k.fact.predicate === 'mission')).toBe(true);
    expect(of(kit.state, LEA).some((k) => k.fact.predicate === 'mission')).toBe(false);
  });

  it('refuse : mission, personnage ou équipe inconnus', () => {
    const { kit, def } = withMission();
    expect(() => assignMission(kit.state, kit.fc, { missionDefId: 'x', to: { characterId: T } })).toThrow(/inconnue/);
    expect(() => assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: 'x' } })).toThrow(
      /absent/,
    );
    expect(() => assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { teamId: 'x' } })).toThrow(/inconnue/);
  });
});

describe('MissionService : évaluation et résolution', () => {
  /** Thomas apprend de Léa (témoin) qui détient le collier. */
  function thomasSeesNecklace(kit: ReturnType<typeof formatKit>) {
    const { item } = placeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, locationId: L.jardin, hidden: true });
    findItem(kit.state, kit.fc, { actorId: LEA, itemId: item.id, witnesses: hears(T) });
  }

  it('active tant que l’objectif n’est pas atteint ; evaluate est pur', () => {
    const { kit, def } = withMission();
    assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    const snapshot = structuredClone(kit.state);
    expect(evaluateMissions(kit.state)).toEqual([]);
    expect(kit.state).toEqual(snapshot);
  });

  it('réussite via le DSL : événement, récompense en effets appliqués, objectif de saison atteint', () => {
    const { kit, def } = withMission();
    const { assignment } = assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    thomasSeesNecklace(kit);
    const trigger = kit.state.nextEventSeq;
    expect(evaluateMissions(kit.state)).toEqual([{ assignmentId: assignment.id, status: 'succeeded' }]);
    const credits = must(kit.state.characters[T]).credits;
    const morale = must(kit.state.characters[T]).stats.morale;
    const out = resolveMissions(kit.state, kit.fc);
    expect(out.events.map((e) => e.type)).toEqual(['mission_succeeded']);
    expect(must(out.events[0]).seq).toBe(trigger);
    expect(assignment).toMatchObject({ status: 'succeeded', resolvedEventId: must(out.events[0]).id });
    expect(must(kit.state.characters[T]).credits).toBe(credits + 15);
    expect(must(kit.state.characters[T]).stats.morale).toBe(morale + 5);
    expect(out.effects.map((e) => [e.targetKind, e.dimension, e.delta, e.valueAfter])).toEqual([
      ['mission', 'status', 0, null],
      ['credit', 'credits', 15, credits + 15],
      ['stat', 'morale', 5, morale + 5],
    ]);
    expect(must(kit.state.characters[T]).goals.find((g) => g.id === assignment.id)?.status).toBe('achieved');
    // Résolue une fois pour toutes.
    expect(resolveMissions(kit.state, kit.fc).events).toEqual([]);
  });

  it('afterEvent relie la résolution à sa cause', () => {
    const { kit, def } = withMission();
    assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    thomasSeesNecklace(kit);
    const cause = { id: 'cause-1' } as Parameters<typeof resolveMissions>[2];
    expect(resolveMissions(kit.state, kit.fc, cause).events[0]?.causedByEventId).toBe('cause-1');
  });

  it('l’échéance dépassée expire la mission et applique la pénalité', () => {
    const { kit, def } = withMission();
    const { assignment } = assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    kit.state.epoch = { id: IDS.epoch, number: 6 };
    const before = must(kit.state.characters[T]).scores.drama;
    const out = resolveMissions(kit.state, kit.at(6, 0));
    expect(out.resolutions).toEqual([{ assignmentId: assignment.id, status: 'expired' }]);
    expect(assignment.status).toBe('expired');
    expect(out.events[0]).toMatchObject({ type: 'mission_failed', payload: { status: 'expired' } });
    expect(must(kit.state.characters[T]).scores.drama).toBe(before - 2);
    expect(must(kit.state.characters[T]).goals.find((g) => g.id === assignment.id)?.status).toBe('abandoned');
  });

  it('la condition d’échec fait échouer la mission avant l’échéance', () => {
    const { kit, def } = withMission({ failure: { stat: { who: '$self', stat: 'morale', cmp: { lt: 10 } } } });
    const { assignment } = assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    must(kit.state.characters[T]).stats.morale = 5;
    expect(resolveMissions(kit.state, kit.fc).resolutions).toEqual([{ assignmentId: assignment.id, status: 'failed' }]);
  });

  it('la réussite l’emporte sur l’échec et l’expiration', () => {
    const { kit, def } = withMission({ failure: { epoch_gte: 0 }, objective: { epoch_gte: 0 } });
    assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { characterId: T } });
    expect(evaluateMissions(kit.state)[0]?.status).toBe('succeeded');
  });

  it('une mission d’équipe applique la récompense à chaque membre', () => {
    const { kit } = withMission();
    const team = createTeam(kit.state, kit.fc, { slug: 'red', name: 'Rouges' }).team;
    for (const id of [A, S]) moveCharacter(kit.state, kit.fc, id, team.id);
    const def = missionDef({
      id: SUPPLY,
      slug: 'supply',
      scope: 'team',
      objective: { epoch_gte: 0 },
      reward: { stats: { morale: 10 } },
    });
    formatOf(kit.state).missionDefs[def.id] = def;
    assignMission(kit.state, kit.fc, { missionDefId: def.id, to: { teamId: team.id } });
    const base = [A, S, T].map((id) => must(kit.state.characters[id]).stats.morale);
    resolveMissions(kit.state, kit.fc);
    expect([A, S, T].map((id) => must(kit.state.characters[id]).stats.morale)).toEqual([
      must(base[0]) + 10,
      must(base[1]) + 10,
      base[2],
    ]);
  });
});

describe('TeamService', () => {
  const build = () => {
    const kit = formatKit(2, 0);
    const red = createTeam(kit.state, kit.fc, { slug: 'red', name: 'Rouges', campLocationId: L.jardin }).team;
    const yellow = createTeam(kit.state, kit.fc, { slug: 'yellow', name: 'Jaunes' }).team;
    for (const id of [A, S]) moveCharacter(kit.state, kit.fc, id, red.id);
    for (const id of [LEA, T]) moveCharacter(kit.state, kit.fc, id, yellow.id);
    return { kit, red, yellow };
  };

  it('création : slug unique parmi les équipes vivantes, camp existant', () => {
    const { kit } = build();
    expect(() => createTeam(kit.state, kit.fc, { slug: 'red', name: 'X' })).toThrow(/déjà présente/);
    expect(() => createTeam(kit.state, kit.fc, { slug: 'blue', name: 'X', campLocationId: 'inconnu' })).toThrow(
      /absent/,
    );
  });

  it('déplacement : adhésion datée, l’historique reste', () => {
    const { kit, red, yellow } = build();
    expect(membersOf(formatOf(kit.state), red.id, 2)).toEqual([A, S].sort());
    const out = moveCharacter(kit.state, kit.at(4, 0), A, yellow.id);
    expect(out.events[0]).toMatchObject({
      type: 'team_member_moved',
      payload: { characterId: A, fromTeamId: red.id, toTeamId: yellow.id },
    });
    const fs = formatOf(kit.state);
    expect(teamOf(fs, A, 3)).toBe(red.id);
    expect(teamOf(fs, A, 4)).toBe(yellow.id);
    expect(membersOf(fs, red.id, 4)).toEqual([S]);
    expect(membersOf(fs, red.id, 2)).toEqual([A, S].sort());
    // Rester dans la même équipe ne change rien.
    expect(moveCharacter(kit.state, kit.at(4, 0), A, yellow.id).events).toEqual([]);
    // Sortir de toute équipe.
    moveCharacter(kit.state, kit.at(5, 0), A, null);
    expect(teamOf(fs, A, 5)).toBeNull();
  });

  it('fusion : nouvelle équipe, tous les membres déplacés, anciennes équipes dissoutes', () => {
    const { kit, red, yellow } = build();
    const out = mergeTeams(kit.state, kit.at(4, 0), [red.id, yellow.id], { slug: 'merged', name: 'Fusion' });
    const fs = formatOf(kit.state);
    expect(out.moved).toEqual([A, S, LEA, T].sort());
    expect(membersOf(fs, out.team.id, 4)).toEqual([A, S, LEA, T].sort());
    expect(membersOf(fs, red.id, 4)).toEqual([]);
    expect(membersOf(fs, red.id, 3)).toEqual([A, S].sort());
    expect([red.dissolvedEpoch, yellow.dissolvedEpoch, out.team.createdEpoch]).toEqual([4, 4, 4]);
    expect(out.events.map((e) => e.type)).toEqual([
      'team_created',
      'team_merged',
      ...Array(4).fill('team_member_moved'),
    ]);
    expect(out.events[1]?.payload).toMatchObject({ into: out.team.id, from: [red.id, yellow.id] });
    expect(() => moveCharacter(kit.state, kit.at(5, 0), A, red.id)).toThrow(/dissoute/);
  });

  it('fusion refusée si moins de deux équipes ou équipe dissoute ; rien n’est modifié', () => {
    const { kit, red, yellow } = build();
    const before = structuredClone(formatOf(kit.state));
    expect(() => mergeTeams(kit.state, kit.at(4, 0), [red.id], { slug: 'm', name: 'M' })).toThrow(/deux/);
    expect(() => mergeTeams(kit.state, kit.at(4, 0), [red.id, 'x'], { slug: 'm', name: 'M' })).toThrow(/inconnue/);
    expect(formatOf(kit.state)).toEqual(before);
    mergeTeams(kit.state, kit.at(4, 0), [red.id, yellow.id], { slug: 'm', name: 'M' });
    expect(() => mergeTeams(kit.state, kit.at(5, 0), [red.id, yellow.id], { slug: 'n', name: 'N' })).toThrow(
      /dissoute/,
    );
  });
});

describe('FormatService : format de saison', () => {
  it('les préréglages villa et adventure sont valides ; adventure suit le §7', () => {
    const adventure = parseSeasonFormat({ format: 'adventure' });
    expect(adventure).toMatchObject({ format: 'adventure', ticksPerEpoch: 32, economy: { enabled: false } });
    expect(adventure.teams.map((t) => t.slug)).toEqual(['red', 'yellow']);
    expect(adventure.items.map((i) => i.slug)).toEqual(['immunity_necklace', 'clue', 'food_ration']);
    expect(adventure.schedule.map((s) => s.kind)).toEqual(['challenge', 'council', 'merge', 'item_drop', 'final']);
    expect(parseSeasonFormat(ADVENTURE_FORMAT as Record<string, unknown>).schedule).toHaveLength(5);
    const villa = parseSeasonFormat({});
    expect(villa).toMatchObject({ format: 'villa', economy: { enabled: true }, teams: [], items: [] });
    expect(parseSeasonFormat(VILLA_FORMAT as Record<string, unknown>).survival.eliminationBy).toBe('public_vote');
  });

  it('une clé fournie remplace celle du préréglage ; une config invalide est refusée', () => {
    expect(parseSeasonFormat({ format: 'adventure', teams: [] }).teams).toEqual([]);
    expect(() => parseSeasonFormat({ format: 'adventure', schedule: [{ kind: 'council' }] })).toThrow(/invalide/);
    expect(() => parseSeasonFormat({ format: 'adventure', schedule: [{ kind: 'danse', every: 1 }] })).toThrow();
    expect(() => parseSeasonFormat({ format: 'adventure', items: [{ slug: 'x', kind: 'magique' }] })).toThrow();
    expect(() =>
      parseSeasonFormat({ format: 'adventure', schedule: [{ kind: 'merge', trigger: { vole: 1 } }] }),
    ).toThrow();
    expect(() => parseSeasonFormat({ format: 'adventure', surprise: true })).toThrow();
  });

  it('load lit season.format et le valide', async () => {
    const storage = createMemoryStorage();
    await seedWorld(storage);
    const service = createFormatService(storage);
    expect((await service.load(IDS.season)).format).toBe('villa');
    await storage.tx((s) => s.seasons.updateRules(IDS.season, {}, 1));
    await expect(service.load(IDS.world)).rejects.toThrow(/introuvable/);
  });
});

describe('FormatService : calendrier et déclencheurs', () => {
  const calendar = () => {
    const kit = formatKit(0, 0);
    const format = parseSeasonFormat({ format: 'adventure' });
    const ids = simIdFactory(kit.state.world.seed, kit.state.world.config, 0, 0, 'sched');
    const nodes = expandSchedule(format, 8, ids);
    const fs = formatOf(kit.state);
    for (const n of nodes) fs.scheduled[n.id] = n;
    // Douze personnages en jeu : les déclencheurs `count_active ≤ 10` ne sont pas vrais d'emblée.
    const extra = Array.from({ length: 8 }, (_, i) => `x${String(i)}`);
    for (const id of extra)
      kit.state.characters[id] = { ...must(kit.state.characters[A]), id, slug: id, status: 'active' };
    return { kit, fs, nodes, format, extra };
  };

  it('expandSchedule : une épreuve et un conseil par époque, les déclencheurs une seule fois, la mission planifiée', () => {
    const { nodes } = calendar();
    const count = (kind: string) => nodes.filter((n) => n.kind === kind).length;
    expect([
      count('challenge'),
      count('council'),
      count('merge'),
      count('item_drop'),
      count('final'),
      count('mission_assign'),
    ]).toEqual([8, 8, 1, 1, 1, 1]);
    const mission = nodes.find((n) => n.kind === 'mission_assign');
    expect(mission).toMatchObject({
      epoch: 3,
      announced: false,
      params: { mission: 'find_necklace_holder', random: 2 },
    });
  });

  it('due : dates fixes au bon (époque, tick), jamais deux fois', () => {
    const { kit, fs } = calendar();
    const dueAt = (epoch: number, tick: number) =>
      dueEvents(epoch, tick, kit.state).map((e) => `${e.kind}@${String(e.epoch)}:${String(e.tickStart)}`);
    expect(dueAt(0, 12)).toEqual(['challenge@0:12']);
    expect(dueAt(0, 11)).toEqual([]);
    expect(dueAt(2, 28)).toEqual(['council@2:28']);
    expect(dueAt(3, 0)).toEqual(['mission_assign@3:0']);
    const challenge = must(dueEvents(1, 12, kit.state)[0]);
    must(fs.scheduled[challenge.id]).firedEventId = 'fait';
    expect(dueAt(1, 12)).toEqual([]);
  });

  it('due : déclencheurs du DSL (count_active ≤ 10 pour la fusion, ≤ 3 pour la finale)', () => {
    const { kit, extra } = calendar();
    const kinds = () => dueEvents(0, 5, kit.state).map((e) => e.kind);
    expect(kinds()).toEqual([]); // 12 en jeu
    for (const id of extra.slice(0, 2)) must(kit.state.characters[id]).status = 'eliminated';
    expect(kinds()).toEqual(['merge']); // 10 en jeu
    for (const id of extra) must(kit.state.characters[id]).status = 'eliminated';
    must(kit.state.characters[T]).status = 'eliminated';
    expect(kinds().sort()).toEqual(['final', 'merge']); // 3 en jeu
  });

  it('due : « collier introuvable après l’époque 6 » dépose un indice', () => {
    const { kit, fs } = calendar();
    const dropAt = (epoch: number) => dueEvents(epoch, 0, kit.state).filter((e) => e.kind === 'item_drop');
    kit.state.epoch = { id: IDS.epoch, number: 5 };
    expect(dropAt(5)).toEqual([]);
    kit.state.epoch = { id: IDS.epoch, number: 6 };
    expect(dropAt(6)).toHaveLength(1);
    // Le collier a été trouvé : plus de dépôt.
    const necklace = placeItem(kit.state, kit.fc, { itemDefId: DEF.necklace, locationId: L.jardin, hidden: true }).item;
    findItem(kit.state, kit.fc, { actorId: LEA, itemId: necklace.id });
    expect(fs.items[necklace.id]?.holderId).toBe(LEA);
    expect(dropAt(6)).toEqual([]);
  });

  it('fire merge : fusionne les équipes vivantes (scénario merge)', () => {
    const { kit, nodes } = calendar();
    const fs = formatOf(kit.state);
    const red = createTeam(kit.state, kit.fc, { slug: 'red', name: 'R' }).team;
    const yellow = createTeam(kit.state, kit.fc, { slug: 'yellow', name: 'J' }).team;
    for (const id of [A, S]) moveCharacter(kit.state, kit.fc, id, red.id);
    for (const id of [LEA, T]) moveCharacter(kit.state, kit.fc, id, yellow.id);
    const merge = must(nodes.find((n) => n.kind === 'merge'));
    const out = fireScheduled(kit.state, kit.at(0, 7), merge.id, { rng: Rng.derive('s', 1) });
    expect(out.dispatched).toEqual(['merge']);
    expect(out.events[0]).toMatchObject({ type: 'scheduled_fired', payload: { kind: 'merge' } });
    expect(merge.firedEventId).toBe(must(out.events[0]).id);
    expect(
      Object.values(fs.teams)
        .filter((t) => t.dissolvedEpoch === null)
        .map((t) => t.slug),
    ).toEqual(['merged']);
    expect(() => fireScheduled(kit.state, kit.fc, merge.id, { rng: Rng.derive('s', 1) })).toThrow(/déjà/);
    expect(() => fireScheduled(kit.state, kit.fc, 'x', { rng: Rng.derive('s', 1) })).toThrow(/inconnu/);
  });

  it('fire item_drop et mission_assign exécutent leur effet ; un conseil est laissé à l’appelant', () => {
    const { kit, nodes } = calendar();
    const fs = formatOf(kit.state);
    fs.missionDefs[MISSION] = missionDef({ id: MISSION, slug: 'find_necklace_holder', objective: { epoch_gte: 99 } });
    const rng = Rng.derive('fire', 1);
    const drop = fireScheduled(kit.state, kit.fc, must(nodes.find((n) => n.kind === 'item_drop')).id, { rng });
    expect(drop.dispatched).toEqual(['item_drop']);
    const clue = must(Object.values(fs.items).find((i) => i.itemDefId === DEF.clue));
    expect([clue.hidden, clue.holderId, kit.state.locations[must(clue.locationId)]?.isPrivate]).toEqual([
      true,
      null,
      false,
    ]);
    const assign = fireScheduled(kit.state, kit.fc, must(nodes.find((n) => n.kind === 'mission_assign')).id, { rng });
    expect(assign.dispatched).toEqual(['mission_assign']);
    expect(Object.values(fs.assignments)).toHaveLength(2);
    expect(new Set(Object.values(fs.assignments).map((a) => a.characterId)).size).toBe(2);
    const council = fireScheduled(kit.state, kit.fc, must(nodes.find((n) => n.kind === 'council')).id, { rng });
    expect(council.dispatched).toEqual([]);
    expect(council.events.map((e) => e.type)).toEqual(['scheduled_fired']);
  });

  it('un événement annoncé est une connaissance publique chez ses participants ; un événement secret non', () => {
    const { kit, nodes } = calendar();
    const council = must(nodes.find((n) => n.kind === 'council'));
    const out = announceScheduled(kit.state, kit.fc, council);
    expect(out.knowledge).toHaveLength(12);
    expect(out.knowledge.every((k) => k.sourceType === 'public' && k.confidence === 1)).toBe(true);
    expect(of(kit.state, S).some((k) => k.fact.objectText === `scheduled:${council.id}`)).toBe(true);
    const hidden = must(nodes.find((n) => n.kind === 'mission_assign'));
    expect(announceScheduled(kit.state, kit.fc, hidden).knowledge).toEqual([]);
  });
});
