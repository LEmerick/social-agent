import type { CharacterRecord } from '../ports/storage.js';
import type { Goal } from '../state/types.js';

/** Traits connus, dans l'ordre fixe où ils apparaissent dans le persona. */
export const TRAIT_KEYS = [
  'charisma',
  'ambition',
  'empathy',
  'loyalty',
  'impulsivity',
  'manipulation',
  'sociability',
  'competitiveness',
] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];

/** Valeur supposée d'un trait non renseigné. */
export const NEUTRAL_TRAIT = 50;

/** Poids de décision, tous dans 0..1 (arrondis à 2 décimales). */
export interface DecisionWeights {
  /** Probabilité de réagir à chaud (impulsivity). */
  readonly reactivity: number;
  /** Bonus aux options qui servent un allié (loyalty). */
  readonly allyBonus: number;
  /** Penchant pour la ruse et la dissimulation (manipulation). */
  readonly deceptionBias: number;
  /** Penchant pour les options coopératives (empathy, sociability). */
  readonly cooperationBias: number;
  /** Envie de s'imposer face aux rivaux (competitiveness). */
  readonly rivalryDrive: number;
  /** Appétit pour l'ascension sociale (ambition). */
  readonly ambitionDrive: number;
  /** Tendance à aller vers les autres (sociability). */
  readonly socialInitiative: number;
  /** Recherche d'ascendant (charisma, ambition). */
  readonly influenceSeeking: number;
}

export interface AgentProfile {
  readonly personaPrompt: string;
  readonly decisionWeights: DecisionWeights;
  readonly goals: readonly Goal[];
}

type Band = 'low' | 'mid' | 'high';

const TENDENCIES: Readonly<Record<TraitKey, Readonly<Record<Band, string>>>> = {
  charisma: {
    low: 'Tu passes facilement inaperçu et tu n’entraînes pas les autres derrière toi.',
    mid: 'Tu as une présence correcte, sans éclipser personne.',
    high: 'Tu captes l’attention dès que tu entres dans une pièce et les autres te suivent volontiers.',
  },
  ambition: {
    low: 'Tu te contentes de ta place et tu cherches peu à monter.',
    mid: 'Tu veux réussir, sans y sacrifier le reste.',
    high: 'Tu veux gagner, monter et être décisif ; tu planifies à long terme.',
  },
  empathy: {
    low: 'Tu perçois mal les émotions des autres et tu t’en soucies peu.',
    mid: 'Tu remarques l’humeur des autres quand elle est évidente.',
    high: 'Tu devines ce que les autres ressentent et tu en tiens compte dans tes choix.',
  },
  loyalty: {
    low: 'Tu te lies sans t’engager : une alliance dure tant qu’elle te sert.',
    mid: 'Tu es fidèle à tes alliés tant que le prix reste raisonnable.',
    high: 'Tu défends tes alliés et tu tiens parole, même quand cela te coûte.',
  },
  impulsivity: {
    low: 'Tu réfléchis avant d’agir et tu gardes ton sang-froid.',
    mid: 'Tu pèses tes réponses, mais tu peux t’emporter sous pression.',
    high: 'Tu réagis à chaud, sans toujours mesurer les conséquences.',
  },
  manipulation: {
    low: 'Tu es franc et tu supportes mal la ruse.',
    mid: 'Tu sais arrondir la vérité quand c’est utile.',
    high: 'Tu déformes, caches ou dose les informations pour orienter les autres à ton avantage.',
  },
  sociability: {
    low: 'Tu préfères rester à l’écart et tu engages rarement la conversation.',
    mid: 'Tu parles volontiers aux gens que tu connais déjà.',
    high: 'Tu vas vers les autres, tu lances les conversations et tu aimes le groupe.',
  },
  competitiveness: {
    low: 'La compétition t’indiffère ; tu évites les confrontations.',
    mid: 'Tu aimes gagner, mais tu sais perdre.',
    high: 'Tu vis tout comme un duel et tu supportes mal d’être battu, surtout par un rival.',
  },
};

const TRAIT_LABELS: Readonly<Record<TraitKey, string>> = {
  charisma: 'Charisme',
  ambition: 'Ambition',
  empathy: 'Empathie',
  loyalty: 'Loyauté',
  impulsivity: 'Impulsivité',
  manipulation: 'Manipulation',
  sociability: 'Sociabilité',
  competitiveness: 'Compétitivité',
};

const band = (value: number): Band => (value <= 30 ? 'low' : value >= 70 ? 'high' : 'mid');
const round2 = (x: number): number => Math.round(x * 100) / 100;

function trait(character: CharacterRecord, key: TraitKey): number {
  return character.traits[key] ?? NEUTRAL_TRAIT;
}

export function decisionWeights(character: CharacterRecord): DecisionWeights {
  const t = (key: TraitKey): number => trait(character, key);
  return {
    reactivity: round2(t('impulsivity') / 100),
    allyBonus: round2(t('loyalty') / 100),
    deceptionBias: round2(t('manipulation') / 100),
    cooperationBias: round2((t('empathy') + t('sociability')) / 200),
    rivalryDrive: round2(t('competitiveness') / 100),
    ambitionDrive: round2(t('ambition') / 100),
    socialInitiative: round2(t('sociability') / 100),
    influenceSeeking: round2((t('charisma') + t('ambition')) / 200),
  };
}

/** Persona stable : mêmes entrées, même texte (il sert de préfixe mis en cache pour le LLM). */
export function personaPrompt(character: CharacterRecord): string {
  const name = [character.firstName, character.lastName].filter((p) => p !== null).join(' ');
  const identity = [
    character.age !== null ? `${String(character.age)} ans` : null,
    character.gender,
    character.origin ? `originaire de ${character.origin}` : null,
  ].filter((p) => p !== null);

  const lines = [`Tu es ${name}${identity.length > 0 ? ` (${identity.join(', ')})` : ''}.`];
  if (character.backstory) lines.push('', `Ton histoire : ${character.backstory}`);

  lines.push('', 'Ton tempérament :');
  for (const key of TRAIT_KEYS) {
    const value = trait(character, key);
    lines.push(`- ${TRAIT_LABELS[key]} (${String(value)}/100) : ${TENDENCIES[key][band(value)]}`);
  }

  lines.push('', `Ta façon de parler : ${character.speechStyle ?? 'naturelle, adaptée à la situation.'}`);
  lines.push(
    '',
    'Tu ne sais que ce que ton personnage a vécu ou appris. Tu ne révèles jamais un fait que tu ignores, et tu restes cohérent avec ton tempérament.',
  );
  return lines.join('\n');
}

/**
 * Compile un personnage en profil d'agent. Pur et déterministe.
 * Le persona ne contient pas les objectifs : il reste identique quand ils changent (préfixe mis en cache).
 */
export function compileAgentProfile(character: CharacterRecord, goals: readonly Goal[] = []): AgentProfile {
  const sorted = [...goals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { personaPrompt: personaPrompt(character), decisionWeights: decisionWeights(character), goals: sorted };
}
