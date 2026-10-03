/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { aWorld, seedWorld } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { ScriptedOutcomeModel } from '../../src/decision/scripted-outcome.js';
import { type DialogueGenerator, SummaryDialogue } from '../../src/interaction/dialogue.js';
import { interactionHook } from '../../src/interaction/index.js';
import { economyHook } from '../../src/economy/hook.js';
import { createEpochScheduler } from '../../src/epoch/index.js';
import { C, L, Z, go, snapshotOf } from '../helpers/epoch-kit.js';
import { runOf } from '../helpers/interaction-kit.js';

/** Générateur de test : dialogue résumé (repli) accompagné d'un verdict de vérification donné. */
const fallbackDialogue: DialogueGenerator = {
  async generate(input) {
    const summary = await new SummaryDialogue().generate(input);
    return {
      ...summary,
      mode: 'summarized',
      verification: {
        verified: false,
        attempts: 3,
        fallback: true,
        reasons: ['refus net', 'ton ambigu'],
        ignoredReveals: ['fait inconnu abc'],
      },
    };
  },
};

describe('vérification du dialogue journalisée', () => {
  it('le verdict (repli, raisons, faits ignorés) va dans classification ; mode suit le repli', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    const decision = new ScriptedDecisionPolicy({
      destinations: { [C.alexandre]: { 0: go(L.jardin, Z.banc) }, [C.sarah]: { 0: go(L.jardin, Z.banc) } },
      actions: {
        [C.alexandre]: {
          0: { action: 'propose_alliance', targetId: C.sarah, factId: null, itemId: null, locationId: null },
        },
      },
    });
    await createEpochScheduler({
      storage,
      decision,
      outcome: new ScriptedOutcomeModel({ propose_alliance: 'accepted_conditional' }),
      hooks: { tick: [interactionHook({ dialogue: fallbackDialogue })], economy: economyHook() },
    }).run(runOf(fixture)).done;

    const { journal } = await snapshotOf(storage, fixture.world.id, 0);
    expect(journal.interactions).toHaveLength(1);
    const [interaction] = journal.interactions;
    expect(interaction!.mode).toBe('summarized');
    expect(interaction!.classification).toMatchObject({
      category: expect.any(String) as unknown,
      verification: {
        verified: false,
        attempts: 3,
        fallback: true,
        reasons: ['refus net', 'ton ambigu'],
        ignoredReveals: ['fait inconnu abc'],
      },
    });
  });

  it('sans vérificateur (dialogue résumé de M3), classification inchangée : pas de clé verification', async () => {
    const storage = createMemoryStorage();
    const fixture = await seedWorld(storage, aWorld().build());
    const decision = new ScriptedDecisionPolicy({
      destinations: { [C.alexandre]: { 0: go(L.jardin, Z.banc) }, [C.sarah]: { 0: go(L.jardin, Z.banc) } },
      actions: {
        [C.alexandre]: {
          0: { action: 'propose_alliance', targetId: C.sarah, factId: null, itemId: null, locationId: null },
        },
      },
    });
    await createEpochScheduler({
      storage,
      decision,
      outcome: new ScriptedOutcomeModel({ propose_alliance: 'accepted' }),
      hooks: { tick: [interactionHook()], economy: economyHook() },
    }).run(runOf(fixture)).done;
    const { journal } = await snapshotOf(storage, fixture.world.id, 0);
    expect(journal.interactions[0]!.classification).not.toHaveProperty('verification');
  });
});
