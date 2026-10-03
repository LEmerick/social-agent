/** Poids de décision d'un nœud personnage du `SimState` (mêmes formules que `character/compile.ts`). */
import { type DecisionWeights, decisionWeights } from '../../character/compile.js';
import type { CharacterRecord } from '../../ports/storage.js';
import type { CharacterNode } from '../../state/types.js';

/**
 * `decisionWeights` ne lit que `traits` : on l'appelle avec les traits du nœud plutôt que de recopier ses formules,
 * pour que `compile.ts` reste l'unique source des poids dérivés des traits.
 */
export const weightsOf = (node: Readonly<Pick<CharacterNode, 'traits'>>): DecisionWeights =>
  decisionWeights({ traits: node.traits } as CharacterRecord);

/** Centre un poids de 0..1 sur −1..+1 (0,5 ⇒ 0) : un trait moyen n'oriente pas la décision. */
export const centered = (w: number): number => 2 * (w - 0.5);

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
