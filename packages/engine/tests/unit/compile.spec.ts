import { describe, expect, it } from 'vitest';
import { compileAgentProfile, decisionWeights, personaPrompt } from '../../src/character/compile.js';
import type { CharacterRecord } from '../../src/ports/storage.js';
import type { Goal } from '../../src/state/types.js';

const alexandre: CharacterRecord = {
  id: '01960000-0000-7000-8000-000000003001',
  worldId: '01960000-0000-7000-8000-000000000001',
  slug: 'alexandre',
  firstName: 'Alexandre',
  lastName: null,
  age: 34,
  gender: 'homme',
  origin: 'Lyon',
  backstory: 'Ancien commercial qui a toujours su convaincre.',
  speechStyle: 'posé, séducteur, phrases soignées',
  autonomy: 'autonomous',
  status: 'active',
  traits: {
    charisma: 85,
    ambition: 90,
    empathy: 35,
    loyalty: 40,
    impulsivity: 45,
    manipulation: 80,
    sociability: 75,
    competitiveness: 70,
  },
};

const goal = (id: string, status: Goal['status'] = 'open'): Goal => ({
  id,
  kind: 'main',
  description: `objectif ${id}`,
  origin: 'player',
  targetCharacterId: null,
  status,
});

describe('compileAgentProfile', () => {
  it('produit un persona stable (snapshot)', () => {
    expect(personaPrompt(alexandre)).toMatchSnapshot();
  });

  it('produit les poids de décision attendus pour Alexandre', () => {
    expect(decisionWeights(alexandre)).toEqual({
      reactivity: 0.45,
      allyBonus: 0.4,
      deceptionBias: 0.8,
      cooperationBias: 0.55,
      rivalryDrive: 0.7,
      ambitionDrive: 0.9,
      socialInitiative: 0.75,
      influenceSeeking: 0.88,
    });
  });

  it('est pur et déterministe', () => {
    const goals = [goal('b'), goal('a')];
    const first = compileAgentProfile(alexandre, goals);
    expect(compileAgentProfile(structuredClone(alexandre), goals)).toEqual(first);
    expect(first.goals.map((g) => g.id)).toEqual(['a', 'b']);
    expect(goals.map((g) => g.id)).toEqual(['b', 'a']); // l'entrée n'est pas modifiée
  });

  it('le persona ne dépend pas des objectifs (préfixe stable pour le cache LLM)', () => {
    expect(compileAgentProfile(alexandre, [goal('a')]).personaPrompt).toBe(
      compileAgentProfile(alexandre).personaPrompt,
    );
  });

  it('traduit les traits forts, faibles et moyens en tendances différentes', () => {
    const loyal = personaPrompt({ ...alexandre, traits: { ...alexandre.traits, loyalty: 95 } });
    const disloyal = personaPrompt({ ...alexandre, traits: { ...alexandre.traits, loyalty: 10 } });
    expect(loyal).toContain('Loyauté (95/100) : Tu défends tes alliés');
    expect(disloyal).toContain('Loyauté (10/100) : Tu te lies sans t’engager');
    expect(loyal).not.toBe(disloyal);
  });

  it('un trait absent vaut 50 (neutre) et les poids restent dans 0..1', () => {
    const nu = { ...alexandre, traits: {} };
    const weights = decisionWeights(nu);
    expect(weights.reactivity).toBe(0.5);
    expect(Object.values(weights).every((w) => w >= 0 && w <= 1)).toBe(true);
    expect(personaPrompt(nu)).toContain('Impulsivité (50/100)');
  });

  it('les poids suivent les traits (impulsivité → réactivité, loyauté → bonus allié, manipulation → ruse)', () => {
    const w = decisionWeights({ ...alexandre, traits: { impulsivity: 100, loyalty: 0, manipulation: 25 } });
    expect(w).toMatchObject({ reactivity: 1, allyBonus: 0, deceptionBias: 0.25 });
  });

  it('omet les champs d’identité absents', () => {
    const persona = personaPrompt({
      ...alexandre,
      age: null,
      gender: null,
      origin: null,
      backstory: null,
      speechStyle: null,
    });
    expect(persona.startsWith('Tu es Alexandre.')).toBe(true);
    expect(persona).not.toContain('Ton histoire');
    expect(persona).toContain('Ta façon de parler : naturelle');
  });
});
