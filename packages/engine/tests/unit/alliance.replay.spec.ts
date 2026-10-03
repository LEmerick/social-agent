/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { ReplayLLM, aWorld, cassetteDir, seedWorld } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { snapshotOf } from '../helpers/epoch-kit.js';
import { llmScheduler, scriptedAllianceLlm } from '../helpers/llm-alliance.js';
import { runOf } from '../helpers/interaction-kit.js';
import { C } from '../helpers/llm-kit.js';

/**
 * `alliance` de bout en bout avec des agents LLM rejoués depuis des cassettes committées : aucun réseau.
 * Régénération : `RECORD=1 pnpm vitest run alliance.replay` (LLM interne scripté, cf. `llm-alliance.ts`).
 */
const dir = cassetteDir('alliance');
const record = process.env.RECORD === '1';

async function play(llm: ReplayLLM) {
  const storage = createMemoryStorage();
  const fixture = await seedWorld(storage, aWorld().build());
  await llmScheduler(storage, fixture, llm).run(runOf(fixture)).done;
  return snapshotOf(storage, fixture.world.id, 0);
}

const replay = () => new ReplayLLM({ dir, record, inner: scriptedAllianceLlm() });

describe('scénario alliance rejoué (ReplayLLM)', () => {
  it('Alexandre propose, Sarah accepte sous conditions : dialogue vérifié, décisions tracées', async () => {
    const { journal } = await play(replay());

    const event = journal.events.find((e) => e.type === 'alliance_proposed')!;
    expect(event.payload).toMatchObject({ action: 'propose_alliance', outcome: 'accepted_conditional' });
    expect(journal.interactions).toHaveLength(1);
    expect(journal.interactions[0]).toMatchObject({
      action: 'propose_alliance',
      mode: 'dialogue',
      initiatorId: C.alexandre,
    });

    expect(journal.utterances.map((u) => [u.speakerId, u.intent, u.volume])).toEqual([
      [C.alexandre, 'propose_alliance', 'whisper'],
      [C.sarah, 'accept_with_conditions', 'whisper'],
    ]);
    expect(journal.utterances.every((u) => u.llmCallId !== null)).toBe(true);

    const alexandreDecisions = journal.decisions
      .filter((d) => d.characterId === C.alexandre)
      .sort((a, b) => (a.kind < b.kind ? -1 : 1));
    expect(alexandreDecisions.map((d) => [d.kind, d.policy])).toEqual([
      ['action', 'llm@1'],
      ['outcome', 'llm@1'],
    ]);
    expect(alexandreDecisions.every((d) => d.llmCallId !== null && d.rngDraw === null)).toBe(true);
    expect(alexandreDecisions[1]!.chosen).toBe('accepted_conditional');
  });

  it('un second rejeu produit exactement le même journal', async () => {
    const first = await play(replay());
    const second = await play(replay());
    const essential = (s: typeof first) => ({
      events: s.journal.events,
      utterances: s.journal.utterances,
      decisions: s.journal.decisions,
      interactions: s.journal.interactions,
      effects: s.journal.effects,
    });
    expect(JSON.stringify(essential(second))).toBe(JSON.stringify(essential(first)));
  });

  it('une cassette manquante fait échouer le rejeu', async () => {
    const empty = new ReplayLLM({ dir: mkdtempSync(join(tmpdir(), 'cassettes-vides-')), record: false });
    await expect(play(empty)).rejects.toMatchObject({ code: 'LLM_CASSETTE_MISSING' });
  });
});
