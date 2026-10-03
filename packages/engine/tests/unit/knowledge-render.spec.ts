import { describe, expect, it } from 'vitest';
import { IDS, aSimState } from '@ai-reality/testkit';
import { renderFactText } from '../../src/knowledge/index.js';
import { buildAgentContext, renderAgentContext } from '../../src/knowledge/index.js';
import type { FactNode } from '../../src/state/types.js';

const { alexandre: A, sarah: S } = IDS.characters;
const state = aSimState();

const fact = (over: Partial<FactNode>): FactNode => ({
  id: 'f',
  subjectId: null,
  predicate: 'x',
  objectId: null,
  objectText: null,
  isTrue: true,
  sensitivity: 1,
  originEventId: null,
  inventedById: null,
  ...over,
});

describe('renderFactText', () => {
  it.each<[string, Partial<FactNode>, string]>([
    [
      'hides',
      { subjectId: S, predicate: 'hides', objectText: 'a déjà participé à une autre émission' },
      'Sarah cache un secret : « a déjà participé à une autre émission »',
    ],
    [
      'proposed_alliance_to',
      { subjectId: A, predicate: 'proposed_alliance_to', objectId: S },
      'Alexandre a proposé une alliance à Sarah',
    ],
    ['allied_with', { subjectId: S, predicate: 'allied_with', objectId: A }, 'Sarah est allié(e) avec Alexandre'],
    ['criticized', { subjectId: A, predicate: 'criticized', objectId: S }, 'Alexandre a critiqué Sarah'],
    ['holds (objet)', { subjectId: S, predicate: 'holds', objectText: 'item:abc' }, 'Sarah détient un objet'],
    [
      'holds (faux objet)',
      { subjectId: S, predicate: 'holds', objectText: 'item_def:immunity_necklace' },
      'Sarah détient un objet (immunity necklace)',
    ],
    ['mission', { subjectId: A, predicate: 'mission', objectText: 'mission:m1' }, 'Alexandre a reçu une mission'],
    ['scheduled', { predicate: 'scheduled', objectText: 'scheduled:s1' }, 'Un événement est programmé'],
  ])('%s', (_name, over, expected) => {
    expect(renderFactText(state, fact(over))).toBe(expected);
  });

  it('item_at nomme le lieu', () => {
    const locationId = IDS.locations.jardin;
    const name = state.locations[locationId]?.name ?? '';
    expect(renderFactText(state, fact({ predicate: 'item_at', objectText: `item:i1@${locationId}` }))).toBe(
      `Un objet se trouve à ${name}`,
    );
  });

  it('repli : prédicat déjà en français gardé, prédicat inconnu « humanisé », jamais de snake_case brut', () => {
    expect(renderFactText(state, fact({ subjectId: A, predicate: 'a menti à', objectId: S }))).toBe(
      'Alexandre a menti à Sarah',
    );
    expect(renderFactText(state, fact({ subjectId: A, predicate: 'shared_a_meal_with', objectId: S }))).toBe(
      'Alexandre shared a meal with Sarah',
    );
    expect(renderFactText(state, fact({ predicate: 'murmure' }))).toBe('murmure');
  });

  it('rendu dans le contexte d’agent : Sarah lit son secret en français', () => {
    const ctx = buildAgentContext(state, S, {
      locationId: IDS.locations.salon,
      sceneMemberIds: [A, S],
      previousTurns: [],
    });
    const text = renderAgentContext(ctx);
    expect(text).toContain('Sarah cache un secret : « a déjà participé à une autre émission »');
    expect(text).not.toContain('hides');
  });
});
