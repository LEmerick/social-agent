import { describe, expect, it } from 'vitest';
import { CharacterSpecSchema, GoalSpecSchema } from '../../src/character/character-spec.js';

const valid = {
  slug: 'alexandre',
  firstName: 'Alexandre',
  autonomy: 'autonomous',
  traits: { ambition: 90, manipulation: 80, loyalty: 40 },
};

const issuesOf = (input: unknown): string[] => {
  const r = CharacterSpecSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`);
};

describe('CharacterSpecSchema', () => {
  it('accepte une spécification minimale et applique les valeurs par défaut', () => {
    const spec = CharacterSpecSchema.parse(valid);
    expect(spec).toMatchObject({
      lastName: null,
      age: null,
      gender: null,
      origin: null,
      backstory: null,
      speechStyle: null,
      goals: [],
    });
  });

  it('accepte l’identité facultative et des objectifs', () => {
    const spec = CharacterSpecSchema.parse({
      ...valid,
      gender: 'homme',
      origin: 'Lyon',
      backstory: 'Ancien commercial.',
      speechStyle: 'posé',
      goals: [{ kind: 'main', description: 'Gagner' }],
    });
    expect(spec.goals).toEqual([{ kind: 'main', description: 'Gagner', origin: 'player', targetCharacterId: null }]);
    expect(spec.speechStyle).toBe('posé');
  });

  it.each([-1, 101, 50.5])('rejette le trait hors 0..100 ou non entier : %s', (value) => {
    expect(issuesOf({ ...valid, traits: { charisma: value } }).join()).toContain('traits.charisma');
  });

  it('rejette une autonomie inconnue', () => {
    expect(issuesOf({ ...valid, autonomy: 'chaotic' }).join()).toContain('autonomy');
  });

  it.each(['Alexandre', 'a b', '-a', 'a-', ''])('rejette le slug invalide « %s »', (slug) => {
    expect(issuesOf({ ...valid, slug }).join()).toContain('slug');
  });

  it('rejette un âge hors 16..120', () => {
    expect(issuesOf({ ...valid, age: 12 }).join()).toContain('age');
  });

  it('rejette un objectif de type inconnu, vide, ou avec une cible qui n’est pas un uuid', () => {
    expect(GoalSpecSchema.safeParse({ kind: 'epic', description: 'x' }).success).toBe(false);
    expect(GoalSpecSchema.safeParse({ kind: 'main', description: '  ' }).success).toBe(false);
    expect(GoalSpecSchema.safeParse({ kind: 'main', description: 'x', targetCharacterId: 'pas-un-uuid' }).success).toBe(
      false,
    );
  });

  it('rejette plus de 20 objectifs', () => {
    const goals = Array.from({ length: 21 }, () => ({ kind: 'main', description: 'x' }));
    expect(issuesOf({ ...valid, goals }).join()).toContain('goals');
  });
});
