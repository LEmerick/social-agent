/** Scénario « chaîne » sur Palmiers : Alexandre et Sarah témoins, Sarah → Léa → Thomas. */
import { IDS, aSimState, fixedId } from '@ai-reality/testkit';
import { simIdFactory } from '../../src/core/sim-ids.js';
import { createFact, transmit, witness } from '../../src/knowledge/index.js';
import type { FactNode, KnowledgeEdge, SimState } from '../../src/state/types.js';

const { alexandre, sarah, lea, thomas } = IDS.characters;

export interface ChainScenario {
  readonly state: SimState;
  readonly fact: FactNode;
  /** Connaissances créées, dans l'ordre de création (parents avant enfants). */
  readonly edges: KnowledgeEdge[];
  readonly agendaOfSarah: SimState['characters'][string]['agenda'];
}

export function runChain(): ChainScenario {
  const state = aSimState();
  const ids = simIdFactory(state.world.seed, state.world.config, 0, 3, 'chain');
  const fact = createFact(
    state,
    { subjectId: alexandre, predicate: 'a proposé une alliance à', objectId: sarah, sensitivity: 2 },
    ids,
  );
  const edges: KnowledgeEdge[] = [];
  const when = (n: number) => ({ viaEventId: null, epoch: 0, tick: n });
  edges.push(
    ...witness(
      state,
      {
        factIds: [fact.id],
        witnesses: [
          { characterId: alexandre, perception: 'hears' },
          { characterId: sarah, perception: 'hears' },
        ],
        ...when(3),
      },
      ids,
    ).knowledge,
  );
  edges.push(
    ...transmit(
      state,
      { factIds: [fact.id], fromId: sarah, listeners: [{ characterId: lea, perception: 'hears' }], ...when(4) },
      ids,
    ).knowledge,
  );
  edges.push(
    ...transmit(
      state,
      { factIds: [fact.id], fromId: lea, listeners: [{ characterId: thomas, perception: 'hears' }], ...when(5) },
      ids,
    ).knowledge,
  );
  return { state, fact, edges, agendaOfSarah: state.characters[sarah]?.agenda ?? [] };
}

export const eventId = (n: number): string => fixedId(0x76, n);
