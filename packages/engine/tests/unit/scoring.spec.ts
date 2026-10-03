/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import { recomputeScores, resolveInteraction, scoreEntriesFor } from '../../src/rules/index.js';
import type { ScoreEntryRecord } from '../../src/state/journal.js';
import { P, idsFor, opt, palmiersFixture } from '../helpers/palmiers.js';

describe('scores', () => {
  it('les effets score produisent des entrées avec le poids de la saison', () => {
    const state = palmiersFixture({
      rules: { scoreWeights: { social: 2, drama: 0.5, popularity: 1, survival: 1, influence: 3 } },
    });
    const ids = idsFor(state);
    const r = resolveInteraction(
      state,
      { option: opt('propose_alliance', P.sarah), actorId: P.alexandre, outcome: 'accepted_conditional' },
      ids,
    );
    expect(r.scoreEntries).toMatchObject([
      {
        characterId: P.alexandre,
        score: 'social',
        impact: 5,
        weight: 2,
        ruleId: 'propose_alliance:accepted_conditional',
        eventId: r.event.id,
      },
      { characterId: P.sarah, score: 'social', impact: 3, weight: 2 },
    ]);
    expect(scoreEntriesFor(state, r.effects, idsFor(state, 'x'))).toHaveLength(2);
    // le score brut du personnage (impact) est porté par l'effet
    expect(state.characters[P.alexandre]!.scores.social).toBe(5);
  });

  it('recomputeScores recalcule par personnage après un changement de poids', () => {
    const state = palmiersFixture();
    const ids = idsFor(state);
    const entries: ScoreEntryRecord[] = [];
    entries.push(
      ...resolveInteraction(
        state,
        { option: opt('propose_alliance', P.sarah), actorId: P.alexandre, outcome: 'accepted_conditional' },
        ids,
      ).scoreEntries,
    );
    entries.push(
      ...resolveInteraction(
        state,
        { option: opt('provoke', P.thomas), actorId: P.alexandre, outcome: 'escalated' },
        ids,
      ).scoreEntries,
    );
    // poids de saison initiaux (tous à 1)
    const before = recomputeScores(entries);
    expect(before.byCharacter[P.alexandre]).toEqual({
      perScore: { social: 5, drama: 3, popularity: 0, survival: 0, influence: 0 },
      total: 8,
    });
    // nouvelle pondération : le drame compte double, le social est divisé par deux
    const after = recomputeScores(entries, { social: 0.5, drama: 2, popularity: 1, survival: 1, influence: 1 });
    expect(after.byCharacter[P.alexandre]).toEqual({
      perScore: { social: 2.5, drama: 6, popularity: 0, survival: 0, influence: 0 },
      total: 8.5,
    });
    expect(after.byCharacter[P.sarah]!.total).toBe(1.5);
    expect(after.byCharacter[P.thomas]!.perScore.drama).toBe(4);
    expect(after.entries.every((e) => e.weight === (e.score === 'drama' ? 2 : 0.5))).toBe(true);
    // les entrées d'origine ne sont pas modifiées
    expect(entries.every((e) => e.weight === 1)).toBe(true);
  });
});
