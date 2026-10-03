/** Outils des tests de formats : état Palmiers avec objets, équipes et contexte de tick. */
import { IDS, aSimState, fixedId } from '@ai-reality/testkit';
import { simIdFactory } from '../../src/core/sim-ids.js';
import type { FormatContext } from '../../src/formats/index.js';
import { type ItemDefNode, type MissionDefNode, formatOf } from '../../src/formats/index.js';
import type { SimState } from '../../src/state/types.js';

export const C = IDS.characters;
export const L = IDS.locations;
export const { alexandre: A, sarah: S, lea: LEA, thomas: T } = IDS.characters;

export const DEF = {
  necklace: fixedId(0x80, 1),
  clue: fixedId(0x80, 2),
  ration: fixedId(0x80, 3),
  statue: fixedId(0x80, 4),
} as const;

export const hears = (...ids: string[]) => ids.map((characterId) => ({ characterId, perception: 'hears' as const }));
export const sees = (...ids: string[]) => ids.map((characterId) => ({ characterId, perception: 'sees' as const }));

const def = (id: string, slug: string, over: Partial<ItemDefNode> = {}): ItemDefNode => ({
  id,
  slug,
  name: slug,
  description: null,
  kind: 'resource',
  effects: {},
  transferable: true,
  expiresAfterEpoch: null,
  visualRef: null,
  ...over,
});

export interface FormatKit {
  readonly state: SimState;
  readonly fc: FormatContext;
  /** Nouveau contexte pour un autre (époque, tick) ; les identifiants restent uniques. */
  at(epoch: number, tick: number): FormatContext;
}

/** Quatre personnages au jardin ; objets : collier (pouvoir, annule les votes, consommé), indice, ration, statuette (non transférable). */
export function formatKit(epoch = 3, tick = 8): FormatKit {
  const state = aSimState((s) => {
    s.epoch = { id: IDS.epoch, number: epoch };
    for (const id of Object.values(IDS.characters))
      s.positions[id] = { kind: 'at', locationId: L.jardin, zoneId: null };
  });
  const fs = formatOf(state);
  for (const d of [
    def(DEF.necklace, 'immunity_necklace', {
      kind: 'power',
      effects: { on: 'vote_session', nullify_votes_against_holder: true, expires: 'after_use' },
    }),
    def(DEF.clue, 'clue', { kind: 'clue', effects: { points_to: 'immunity_necklace' } }),
    def(DEF.ration, 'food_ration'),
    def(DEF.statue, 'statue', { kind: 'cosmetic', transferable: false }),
  ]) {
    fs.itemDefs[d.id] = d;
  }
  const ids = simIdFactory(state.world.seed, state.world.config, epoch, 0, 'format-test');
  const at = (e: number, t: number): FormatContext => ({ ids, epochId: IDS.epoch, epoch: e, tick: t });
  return { state, fc: at(epoch, tick), at };
}

export function missionDef(
  over: Partial<MissionDefNode> & Pick<MissionDefNode, 'id' | 'slug' | 'objective'>,
): MissionDefNode {
  return {
    title: over.slug,
    briefing: `Briefing ${over.slug}`,
    scope: 'individual',
    secrecy: 'secret',
    failure: null,
    reward: {},
    penalty: null,
    deadlineEpochOffset: null,
    ...over,
  };
}

/** Valeur attendue présente (sans assertion non nulle) : échoue clairement sinon. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Valeur attendue absente');
  return value;
}
