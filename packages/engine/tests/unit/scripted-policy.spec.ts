import { describe, expect, it } from 'vitest';
import { IDS, aSimState } from '@ai-reality/testkit';
import { type ActionOption, optionKey } from '../../src/decision/ports.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { Rng } from '../../src/core/rng.js';

const { alexandre: A, sarah: S } = IDS.characters;
const flatter: ActionOption = { action: 'flatter', targetId: S, factId: null, itemId: null, locationId: null };

describe('ScriptedDecisionPolicy', () => {
  const policy = new ScriptedDecisionPolicy({
    destinations: { [A]: { 3: { kind: 'go', locationId: IDS.locations.salon, zoneId: null } } },
    actions: { [A]: { 3: flatter } },
  });
  const input = (tick: number, options: ActionOption[]) => ({
    actorId: A,
    state: aSimState((s) => {
      s.tick = tick;
    }),
    options,
    rng: new Rng(1),
  });

  it('renvoie la destination écrite pour le tick, `stay` sinon', async () => {
    const at = (tick: number) =>
      policy.chooseDestination({ actorId: A, state: input(tick, []).state, rng: new Rng(1) });
    expect(await at(3)).toEqual({ kind: 'go', locationId: IDS.locations.salon, zoneId: null });
    expect(await at(4)).toEqual({ kind: 'stay' });
  });

  it("renvoie l'action écrite si elle figure dans les options, `null` sinon", async () => {
    const hit = await policy.choose(input(3, [flatter]));
    expect(hit).toMatchObject({ policy: 'scripted@1', rngDraw: null });
    expect(hit.chosen && optionKey(hit.chosen)).toBe(optionKey(flatter));
    expect((await policy.choose(input(3, []))).chosen).toBeNull();
    expect((await policy.choose(input(4, [flatter]))).chosen).toBeNull();
  });
});
