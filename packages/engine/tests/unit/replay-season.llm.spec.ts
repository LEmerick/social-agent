import { createMemoryStorage } from '@ai-reality/storage-memory';
import { ReplayLLM, cassetteDir } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { auditSeason, replaySeason } from '../../src/index.js';
import { playLlmChain, scriptedChainLlm } from '../helpers/llm-chain.js';

/**
 * Rejeu depuis le journal d'une époque jouée par des agents LLM (cassettes `chain`, aucun réseau).
 * Les cassettes existantes ne couvrent que le scénario A→B→C→D d'une époque : pas de saison de 5 époques avec LLM.
 */
const replay = () =>
  new ReplayLLM({ dir: cassetteDir('chain'), record: process.env.RECORD === '1', inner: scriptedChainLlm() });

describe('rejeu d’une époque jouée par des agents LLM (ReplayLLM)', () => {
  it('le journal produit par les agents suffit à reconstruire l’état stocké, deux fois de suite', async () => {
    const first = createMemoryStorage();
    const played = await playLlmChain(first, replay());
    const worldId = played.state.world.id;
    const seasonNumber = played.state.season.number;
    expect(played.journal.decisions.some((d) => d.policy === 'llm@1')).toBe(true);

    const result = await replaySeason(first, worldId, seasonNumber);
    expect(result.diffs).toEqual([]);
    expect(result.epochs).toBe(1);
    expect((await auditSeason(first, worldId, seasonNumber)).issues).toEqual([]);

    const second = createMemoryStorage();
    const again = await playLlmChain(second, replay());
    const other = await replaySeason(second, again.state.world.id, again.state.season.number);
    expect(other.stateHash).toBe(result.stateHash);
  });
});
