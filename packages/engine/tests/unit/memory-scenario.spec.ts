/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { createMemoryStorage } from '@ai-reality/storage-memory';
import { FakeEmbedding, aSimState } from '@ai-reality/testkit';
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../../src/core/clock.js';
import { createIdFactory } from '../../src/core/id.js';
import { Rng } from '../../src/core/rng.js';
import { createMemoryService, memoriesFromEvents } from '../../src/memory/index.js';
import { C, anEvent, seedEpochs } from '../helpers/memory-kit.js';

describe('scénario : le rappel de Sarah à l’époque 15', () => {
  it('« à propos d’Alexandre » contient la proposition d’alliance de l’époque 14', async () => {
    const state = aSimState();
    const ids = createIdFactory(new ManualClock(1_800_000_000_000), Rng.derive('scenario-m6', 'ids'));

    // Époque 14, vécue par Sarah : Alexandre lui propose une alliance, Thomas l'insulte, Léa bavarde.
    const events14 = [
      anEvent(
        14,
        'small_talk',
        [
          [C.lea, 'actor'],
          [C.sarah, 'target'],
        ],
        0.1,
      ),
      anEvent(
        14,
        'alliance_proposed',
        [
          [C.alexandre, 'actor'],
          [C.sarah, 'target'],
          [C.lea, 'witness'],
        ],
        0.7,
      ),
      anEvent(
        14,
        'insult',
        [
          [C.thomas, 'actor'],
          [C.sarah, 'target'],
        ],
        0.6,
      ),
    ];
    // Époque 13 : un souvenir plus ancien et sans lien avec Alexandre.
    const events13 = [
      anEvent(
        13,
        'comforted',
        [
          [C.lea, 'actor'],
          [C.sarah, 'target'],
        ],
        0.5,
      ),
    ];

    const storage = createMemoryStorage();
    await seedEpochs(storage, 15);
    const service = createMemoryService(storage, new FakeEmbedding());
    // Les events écrits à la main ne sont pas dans le journal du stockage : on détache la clé étrangère `event_id`
    // après avoir vérifié le lien (le lien eventId → event est couvert par les tests de mémoire du moteur).
    const detach = (drafts: ReturnType<typeof memoriesFromEvents>) => drafts.map((d) => ({ ...d, eventId: null }));
    const drafts14 = memoriesFromEvents(state, C.sarah, events14, ids);
    const proposalDraft = drafts14.find((d) => d.eventId === events14[1]!.id)!;
    await service.record(C.sarah, detach(memoriesFromEvents(state, C.sarah, events13, ids)));
    await service.record(C.sarah, detach(drafts14));
    const created = [{ ...proposalDraft, eventId: events14[1]!.id }];
    const proposal = created[0]!;

    const recalled = await service.recall(C.sarah, { about: [C.alexandre], k: 3, epoch: 15 });
    expect(recalled.map((r) => r.record.id)).toContain(proposal.id);
    expect(recalled[0]!.record.id).toBe(proposal.id);
    expect(recalled[0]!.record.summary).toMatch(/proposé une alliance/);

    // Même chose par similarité de texte, et jamais les souvenirs d'un autre personnage.
    const byText = await service.recall(C.sarah, { text: 'l’alliance proposée par Alexandre', k: 1, epoch: 15 });
    expect(byText[0]!.record.id).toBe(proposal.id);
    expect(await service.recall(C.thomas, { about: [C.alexandre], k: 3, epoch: 15 })).toEqual([]);
  });
});
