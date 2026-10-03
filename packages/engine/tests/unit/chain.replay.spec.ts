import { createMemoryStorage } from '@ai-reality/storage-memory';
import { IDS, ReplayLLM, cassetteDir } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { playLlmChain, scriptedChainLlm } from '../helpers/llm-chain.js';

/**
 * `chain` (A→B→C→D) de bout en bout avec des agents LLM rejoués depuis des cassettes committées : aucun réseau.
 * Régénération : `RECORD=1 npx vitest run packages/engine/tests/unit/chain.replay.spec.ts` (LLM interne scripté).
 */
const dir = cassetteDir('chain');
const record = process.env.RECORD === '1';
const replay = () => new ReplayLLM({ dir, record, inner: scriptedChainLlm() });
const { alexandre, sarah, lea, thomas } = IDS.characters;

describe('scénario chain rejoué (ReplayLLM)', () => {
  it('la chaîne E1 ← E2 ← E3 ← E4 est reconstituée par des agents LLM', async () => {
    const { journal, state, factId } = await playLlmChain(createMemoryStorage(), replay());
    const byType = (type: string) => journal.events.filter((e) => e.type === type);
    const [e1] = byType('alliance_formed');
    const [e2, e3] = byType('secret_shared');
    const [e4] = byType('confrontation');
    expect(byType('secret_shared')).toHaveLength(2);
    expect(e1?.causedByEventId).toBeNull();
    expect(e2?.causedByEventId).toBe(e1?.id);
    expect(e3?.causedByEventId).toBe(e2?.id);
    expect(e4?.causedByEventId).toBe(e3?.id);
    expect(state.facts[factId]?.originEventId).toBe(e1?.id);

    expect(journal.interactions.map((i) => [i.action, i.initiatorId, i.mode])).toEqual([
      ['propose_alliance', alexandre, 'dialogue'],
      ['share_secret', sarah, 'dialogue'],
      ['share_secret', lea, 'dialogue'],
      ['confront', thomas, 'dialogue'],
    ]);
    // Chaque interaction porte son verdict de vérification (journalisé dans `classification`).
    for (const i of journal.interactions) {
      expect(i.classification).toMatchObject({
        verification: { verified: true, attempts: 1, fallback: false, reasons: [], ignoredReveals: [] },
      });
    }
    // Provenance complète : Sarah (témoin) → Léa → Thomas.
    const told = Object.values(state.knowledge).filter((k) => k.factId === factId && k.sourceType === 'told');
    expect(told.map((k) => [k.characterId, k.toldById]).sort()).toEqual(
      expect.arrayContaining([
        [lea, sarah],
        [thomas, lea],
      ]),
    );
    expect(journal.decisions.filter((d) => d.kind === 'action').map((d) => d.policy)).toContain('llm@1');
  });

  it('un second rejeu produit exactement le même journal', async () => {
    const first = await playLlmChain(createMemoryStorage(), replay());
    const second = await playLlmChain(createMemoryStorage(), replay());
    expect(JSON.stringify(second.journal)).toBe(JSON.stringify(first.journal));
  });
});
