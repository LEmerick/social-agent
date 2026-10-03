import type { EffectRecord } from '../../src/state/journal.js';

/** Clé lisible d'un effet : `rel:sarah>alexandre:trust`, `stat:alexandre:influence`… */
export const effectKey = (
  fx: Pick<EffectRecord, 'targetKind' | 'characterId' | 'otherCharacterId' | 'dimension'>,
): string =>
  fx.targetKind === 'relationship'
    ? `rel:${fx.characterId}>${fx.otherCharacterId ?? ''}:${fx.dimension}`
    : `${fx.targetKind}:${fx.characterId}:${fx.dimension}`;

/** Deltas par clé, sans les effets de coût (`cost@1`). */
export function deltas(effects: readonly EffectRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const fx of effects) {
    if (fx.ruleId === 'cost') continue;
    out[effectKey(fx)] = (out[effectKey(fx)] ?? 0) + fx.delta;
  }
  return out;
}
