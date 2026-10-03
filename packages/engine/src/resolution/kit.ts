/**
 * Boîte à outils des règles de résolution : contexte lu par une règle et constructeurs d'effets.
 * Une règle est une fonction pure `(contexte) => EffectInput[]` : elle ne modifie jamais l'état.
 */
import { DomainError } from '../core/errors.js';
import type { ActionOption } from '../decision/ports.js';
import { NEUTRAL_TRAIT, type TraitKey } from '../character/compile.js';
import type { OutcomeId } from '../rules/types.js';
import type { EffectInput } from '../state/journal.js';
import type { Axis, CharacterNode, RelationshipEdge, ScoreName, SimState, StatKey } from '../state/types.js';

/** Effet produit par une règle, avant estampillage (`ruleId`, `ruleVersion`) et habituation. */
export type DraftEffect = Omit<EffectInput, 'ruleId' | 'ruleVersion' | 'reason'>;

export interface RuleCtx {
  readonly state: Readonly<SimState>;
  readonly option: ActionOption;
  readonly a: Readonly<CharacterNode>;
  /** Cible de l'action ; `null` pour les actions sans cible personnage. */
  readonly b: Readonly<CharacterNode> | null;
  /** Arête acteur→cible telle qu'avant l'interaction (arête neutre sans cible). */
  readonly ab: Readonly<RelationshipEdge>;
  /** Arête cible→acteur telle qu'avant l'interaction. */
  readonly ba: Readonly<RelationshipEdge>;
}

interface Side {
  stat(key: StatKey, delta: number): DraftEffect;
  mood(emotion: string, delta: number): DraftEffect;
  score(name: ScoreName, delta: number): DraftEffect;
}

export interface Kit {
  /** Axe de la relation acteur→cible. */
  ab(dimension: Axis, delta: number): DraftEffect;
  /** Axe de la relation cible→acteur. */
  ba(dimension: Axis, delta: number): DraftEffect;
  readonly a: Side;
  readonly b: Side;
}

const side = (c: Readonly<CharacterNode> | null): Side => {
  const who = (): string => {
    if (!c) throw new DomainError('NO_TARGET', 'Règle de cible appelée sans cible');
    return c.id;
  };
  const fx = (targetKind: DraftEffect['targetKind'], dimension: string, delta: number): DraftEffect => ({
    targetKind,
    characterId: who(),
    otherCharacterId: null,
    dimension,
    delta,
  });
  return {
    stat: (key, delta) => fx('stat', key, delta),
    mood: (emotion, delta) => fx('mood', emotion, delta),
    score: (name, delta) => fx('score', name, delta),
  };
};

export function kitFor(c: RuleCtx): Kit {
  const rel = (from: Readonly<CharacterNode> | null, to: Readonly<CharacterNode> | null) => {
    return (dimension: Axis, delta: number): DraftEffect => {
      if (!from || !to) throw new DomainError('NO_TARGET', 'Règle de relation appelée sans cible');
      return { targetKind: 'relationship', characterId: from.id, otherCharacterId: to.id, dimension, delta };
    };
  };
  return { ab: rel(c.a, c.b), ba: rel(c.b, c.a), a: side(c.a), b: side(c.b) };
}

/** Valeur d'un trait (0..100), neutre s'il n'est pas renseigné. */
export const trait = (c: Readonly<CharacterNode>, key: TraitKey): number => c.traits[key] ?? NEUTRAL_TRAIT;

/** Modulation linéaire autour de la valeur neutre 50 : `m(80, 0.1) = +3`. */
export const m = (value: number, perPoint: number): number => (value - 50) * perPoint;

export type RuleFn = (c: RuleCtx, k: Kit) => DraftEffect[];
export type RuleSet = Partial<Record<OutcomeId, RuleFn>>;

/** Variante d'un jeu de règles dont tous les deltas sont multipliés (`insult` = `provoke` × 1.4…). */
export function scaled(set: RuleSet, factor: number): RuleSet {
  return Object.fromEntries(
    Object.entries(set).map(([outcome, fn]) => [
      outcome,
      (c: RuleCtx, k: Kit) => fn(c, k).map((e) => ({ ...e, delta: e.delta * factor })),
    ]),
  );
}

/** Trait de la cible (0..100) ; erreur si l'action n'a pas de cible personnage. */
export const traitB = (c: RuleCtx, key: TraitKey): number => {
  if (!c.b) throw new DomainError('NO_TARGET', 'Trait de cible demandé sans cible');
  return trait(c.b, key);
};
