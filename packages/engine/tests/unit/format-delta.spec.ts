import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { HeuristicOutcomeModel, type StoragePort } from '../../src/index.js';
import { UniformRandomPolicy, adventureWorld, sampleFormatState, seedWorld } from '@ai-reality/testkit';
import {
  FORMAT_DELTA_INDEX,
  type FormatDelta,
  diffFormat,
  loadFormatState,
  mergeFormatDeltas,
  seedFormatBaseline,
} from '../../src/formats/persist.js';
import { defaultEdge } from '../../src/state/apply-effect.js';
import { relOf } from '../../src/rules/preconditions.js';
import { relKey } from '../../src/state/types.js';
import { formatScheduler, runNumber } from '../helpers/format-run-kit.js';
import { C } from '../helpers/epoch-kit.js';

const sample = () => sampleFormatState({ e1: 'e1', e2: 'e2', e3: 'e3' }, 'scene1');

describe('persistance différentielle du FormatState', () => {
  it('le premier delta contient tout, puis seulement ce qui change', () => {
    const owner = {};
    const fs = sample();
    const first = diffFormat(owner, fs);
    expect(first).not.toBeNull();
    expect(Object.keys(first?.items ?? {})).toEqual(Object.keys(fs.items));
    expect(first?.runtime).not.toBeNull();

    expect(diffFormat(owner, fs)).toBeNull();

    const [itemId] = Object.keys(fs.items);
    if (!itemId) throw new Error('fixture sans objet');
    const item = fs.items[itemId];
    if (!item) throw new Error('objet introuvable');
    item.hidden = !item.hidden;
    const second = diffFormat(owner, fs);
    expect(Object.keys(second?.items ?? {})).toEqual([itemId]);
    expect(second?.teams).toEqual({});
    expect(second?.runtime).toBeNull();

    fs.presence['a|b'] = 3;
    const third = diffFormat(owner, fs);
    expect(third?.runtime?.presence['a|b']).toBe(3);
    expect(third?.items).toEqual({});
  });

  it('un état relu en base sert de référence : rien à écrire tant qu’il ne change pas', () => {
    const owner = {};
    const fs = sample();
    seedFormatBaseline(owner, fs);
    expect(diffFormat(owner, fs)).toBeNull();
  });

  it('deux deltas d’un même tick fusionnent, le dernier l’emporte', () => {
    const owner = {};
    const fs = sample();
    diffFormat(owner, fs);
    const [itemId] = Object.keys(fs.items);
    if (!itemId) throw new Error('fixture sans objet');
    const item = fs.items[itemId];
    if (!item) throw new Error('objet introuvable');
    item.hidden = !item.hidden;
    const early = diffFormat(owner, fs);
    item.state = 'used';
    const late = diffFormat(owner, fs);
    if (!early || !late) throw new Error('deltas attendus');
    const merged = mergeFormatDeltas(early, late);
    expect(merged.items[itemId]?.state).toBe('used');
    expect(Object.keys(merged.items)).toEqual([itemId]);
  });

  it('une époque de format ne dépose le FormatState que quand il change, et la base reste exacte', async () => {
    const memory = createMemoryStorage();
    const fixture = await seedWorld(memory, adventureWorld({ seed: 'delta-m8b', characters: 8 }));
    const deltas: (FormatDelta | undefined)[] = [];
    const watching: StoragePort = {
      tx: (fn) =>
        memory.tx((s) =>
          fn({
            ...s,
            journal: {
              ...s.journal,
              commitTick: (batch) => {
                deltas.push(batch.ext['format']?.[FORMAT_DELTA_INDEX] as FormatDelta | undefined);
                return s.journal.commitTick(batch);
              },
            },
          }),
        ),
    };
    const scheduler = formatScheduler(watching, new UniformRandomPolicy({ moveProbability: 0.25 }), {
      outcome: new HeuristicOutcomeModel(),
      seasonEpochs: 2,
    });
    const result = await scheduler.run(runNumber(fixture, 0)).done;

    const written = deltas.filter((d): d is FormatDelta => d !== undefined);
    expect(written.length).toBeGreaterThan(0);
    expect(written.length).toBeLessThan(result.ticksPerEpoch);
    // Le premier dépôt couvre tout ; les suivants ne portent que des entités modifiées.
    const size = (d: FormatDelta): number =>
      Object.keys(d.items).length +
      Object.keys(d.teams).length +
      Object.keys(d.scheduled).length +
      Object.keys(d.assignments).length +
      Object.keys(d.voteSessions).length;
    const [first, ...rest] = written;
    expect(first && size(first)).toBeGreaterThan(0);
    for (const d of rest) expect(size(d)).toBeLessThan(first ? size(first) : 0);

    const states = await memory.tx((s) => s.characterStates.listByEpoch(result.epochId));
    expect(states).toHaveLength(8);
    const reloaded = await loadFormatState(memory, fixture.season.id);
    expect(Object.keys(reloaded.scheduled).length).toBe(Object.keys(first?.scheduled ?? {}).length);
  });
});

describe('relOf', () => {
  it('lire une relation absente n’alloue pas, n’insère rien et renvoie toujours la même arête figée', () => {
    const state = { relationships: {} } as Parameters<typeof relOf>[0];
    const a = relOf(state, C.alexandre, C.sarah);
    const b = relOf(state, C.alexandre, C.sarah);
    expect(a).toBe(b);
    expect(Object.keys(state.relationships)).toEqual([]);
    expect(a).toEqual(defaultEdge(C.alexandre, C.sarah));
    expect(Object.isFrozen(a)).toBe(true);
    expect(relOf(state, C.sarah, C.alexandre)).not.toBe(a);
  });

  it('une relation présente est renvoyée telle quelle', () => {
    const edge = { ...defaultEdge(C.alexandre, C.sarah), trust: 77 };
    const state = { relationships: { [relKey(C.alexandre, C.sarah)]: edge } } as Parameters<typeof relOf>[0];
    expect(relOf(state, C.alexandre, C.sarah)).toBe(edge);
  });
});
