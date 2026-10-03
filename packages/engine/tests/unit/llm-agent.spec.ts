/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests : accès indexés sur des fixtures connues */
import { describe, expect, it } from 'vitest';
import { FakeLLM, IDS } from '@ai-reality/testkit';
import { type AgentDiagnostic, createAgentRuntime } from '../../src/agent/runtime.js';
import { buildAgentContext } from '../../src/agent/context.js';
import { compileDirective } from '../../src/agent/directive.js';
import { situationOf } from '../../src/agent/situation.js';
import { DomainError } from '../../src/core/errors.js';
import { LLM_POLICY, LlmDecisionPolicy } from '../../src/decision/llm-policy.js';
import { LlmOutcomeModel } from '../../src/decision/llm-outcome.js';
import { ScriptedDecisionPolicy } from '../../src/decision/scripted-policy.js';
import { LlmDialogue } from '../../src/interaction/llm-dialogue.js';
import { LlmInvalidOutputError } from '../../src/llm/index.js';
import { C, dialogueInput, option, palmiersAtGarden, personaOf, speakReply } from '../helpers/llm-kit.js';
import { Rng } from '../../src/core/rng.js';

const secret = IDS.facts.sarahSecret;

describe('AgentRuntime : sorties structurées', () => {
  const ctxOf = (id: string) => {
    const state = palmiersAtGarden();
    return buildAgentContext(state, id, situationOf(state, id));
  };
  const turn = { action: 'propose_alliance', outcome: 'accepted', turn: { index: 1, max: 4 } };

  it('JSON invalide ⇒ nouvel essai, qui rend compte de la faute', async () => {
    const llm = new FakeLLM({ rules: [{ purpose: 'speak', replies: ['pas du json', speakReply()] }] });
    const runtime = createAgentRuntime({ llm, persona: personaOf });
    const spoken = await runtime.speak(ctxOf(C.alexandre), turn);
    expect(spoken.text).toBe('Sarah, on devrait faire équipe.');
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]!.messages.at(-1)!.content).toContain('invalide');
  });

  it('JSON invalide deux fois ⇒ erreur typée LLM_INVALID_OUTPUT', async () => {
    const llm = new FakeLLM({ rules: [{ purpose: 'speak', replies: ['pas du json', { text: 3 }] }] });
    const runtime = createAgentRuntime({ llm, persona: personaOf });
    const failure = await runtime.speak(ctxOf(C.alexandre), turn).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LlmInvalidOutputError);
    expect((failure as LlmInvalidOutputError).code).toBe('LLM_INVALID_OUTPUT');
    expect(llm.requests).toHaveLength(2);
  });

  it('reveals d’un fait inconnu ⇒ ignoré et signalé ; fait connu ⇒ gardé', async () => {
    const seen: AgentDiagnostic[] = [];
    const llm = new FakeLLM({ rules: [{ purpose: 'speak', replies: [speakReply({ reveals: [`[${secret}]`] })] }] });
    const runtime = createAgentRuntime({ llm, persona: personaOf, onDiagnostic: (d) => seen.push(d) });

    const alexandre = await runtime.speak(ctxOf(C.alexandre), turn);
    expect(alexandre.reveals).toEqual([]);
    expect(alexandre.ignoredReveals).toEqual([secret]);
    expect(seen).toEqual([{ kind: 'ignored_reveal', characterId: C.alexandre, detail: secret }]);

    const sarah = await runtime.speak(ctxOf(C.sarah), turn);
    expect(sarah.reveals).toEqual([secret]);
    expect(sarah.ignoredReveals).toEqual([]);
  });

  it('plan : cibles, lieux et faits inconnus sont écartés et signalés', async () => {
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'plan',
          replies: [
            {
              intentions: [
                { kind: 'talk_to', target: 'Sarah', goal: 'allié', factId: null, location: null, priority: 0.4 },
                { kind: 'go_to', target: null, goal: null, factId: null, location: 'Salon', priority: 0.8 },
                { kind: 'talk_to', target: 'Inconnu', goal: null, factId: null, location: null, priority: 0.9 },
                { kind: 'tell', target: 'Léa', goal: null, factId: secret, location: null, priority: 0.7 },
                { kind: 'go_to', target: null, goal: null, factId: null, location: 'Lune', priority: 0.7 },
              ],
            },
          ],
        },
      ],
    });
    const state = palmiersAtGarden();
    const runtime = createAgentRuntime({ llm, persona: personaOf });
    const plan = await runtime.plan(buildAgentContext(state, C.alexandre, situationOf(state, C.alexandre)), {
      locations: Object.values(state.locations).map((l) => ({ id: l.id, name: l.name })),
      names: { [C.sarah]: 'Sarah', [C.lea]: 'Léa' },
    });
    expect(plan.intentions.map((i) => [i.kind, i.targetId ?? i.locationId])).toEqual([
      ['go_to', IDS.locations.salon],
      ['talk_to', C.sarah],
    ]);
    expect(plan.ignored).toHaveLength(3);
  });

  it('reflect : croyances sur faits connus seulement, objectifs par rang', async () => {
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'reflect',
          replies: [
            {
              beliefs: [
                { factId: secret, belief: 'doubts', confidence: 0.9 },
                { factId: 'fait-fantome', belief: 'believes', confidence: 0.5 },
              ],
              goalUpdates: [
                { goalIndex: 0, status: 'achieved' },
                { goalIndex: 9, status: 'abandoned' },
              ],
            },
          ],
        },
      ],
    });
    const runtime = createAgentRuntime({ llm, persona: personaOf });
    const r = await runtime.reflect(ctxOf(C.sarah), { epoch: 0, highlights: ['Alexandre m’a parlé.'] });
    expect(r.beliefs).toEqual([{ factId: secret, belief: 'doubts', confidence: 0.9 }]);
    expect(r.goalUpdates).toEqual([{ goalIndex: 0, status: 'achieved' }]);
    expect(r.ignored).toHaveLength(2);
  });
});

describe('LlmDecisionPolicy', () => {
  const options = [option('small_talk', C.sarah), option('propose_alliance', C.sarah), option('rest')];
  const build = (llm: FakeLLM) =>
    new LlmDecisionPolicy({ llm, persona: personaOf, destination: new ScriptedDecisionPolicy() });
  const input = (state = palmiersAtGarden()) => ({ actorId: C.alexandre, state, options, rng: Rng.derive('t') });

  it('retient l’option numérotée, avec sa distribution normalisée et sa traçabilité', async () => {
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'evaluate',
          replies: [
            {
              choice: '2',
              distribution: [
                { choice: '1', p: 0.2 },
                { choice: '2', p: 0.6 },
                { choice: 'none', p: 0.2 },
              ],
            },
          ],
        },
      ],
    });
    const result = await build(llm).choose(input());
    expect(result.chosen).toEqual(options[1]);
    expect(result.policy).toBe(LLM_POLICY);
    expect(result.rngDraw).toBeNull();
    expect(result.llmCallId).toEqual(expect.any(String));
    expect(result.distribution?.map((d) => d.option.action)).toEqual(['small_talk', 'propose_alliance']);
    expect(result.distribution?.reduce((t, d) => t + d.p, 0)).toBeCloseTo(1, 10);
    const prompt = llm.requests[0]!.messages[0]!.content;
    expect(prompt).toContain('1. small_talk → Sarah');
    expect(prompt).toContain('2. propose_alliance → Sarah');
  });

  it('« none » ⇒ aucune action', async () => {
    const llm = new FakeLLM({ rules: [{ purpose: 'evaluate', replies: [{ choice: 'none' }] }] });
    expect((await build(llm).choose(input())).chosen).toBeNull();
  });

  it.each(['teleport', '7', 'propose_alliance', ''])('réponse hors catalogue « %s » ⇒ rejet', async (choice) => {
    const llm = new FakeLLM({ rules: [{ purpose: 'evaluate', replies: [{ choice }] }] });
    const failure = await build(llm)
      .choose(input())
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe('INVALID_CHOICE');
  });

  it('présente les biais de la directive dans le prompt', async () => {
    const llm = new FakeLLM({ rules: [{ purpose: 'evaluate', replies: [{ choice: 'none' }] }] });
    const state = palmiersAtGarden((s) => {
      s.characters[C.alexandre]!.directive = {
        actions: { propose_alliance: 1.5 },
        targets: { [C.sarah]: 1.2 },
        prefer: [],
        forbid: ['insult'],
      };
    });
    await build(llm).choose(input(state));
    const request = llm.requests[0]!;
    expect(request.system.variable).toContain('Consigne du joueur');
    expect(request.system.variable).toContain('Sarah +1.2');
    expect(request.system.variable).toContain('À éviter : insult');
    expect(request.messages[0]!.content).toContain('2. propose_alliance → Sarah [consigne +2.7]');
  });

  it('aucune option ⇒ aucun appel ; la destination reste sans LLM', async () => {
    const llm = new FakeLLM();
    const policy = build(llm);
    expect((await policy.choose({ ...input(), options: [] })).chosen).toBeNull();
    const destination = await policy.chooseDestination({
      actorId: C.alexandre,
      state: palmiersAtGarden(),
      rng: Rng.derive('t'),
    });
    expect(destination).toEqual({ kind: 'stay' });
    expect(llm.requests).toHaveLength(0);
  });
});

describe('LlmOutcomeModel', () => {
  const model = (llm: FakeLLM) => new LlmOutcomeModel({ llm, persona: personaOf });
  const input = { option: option('propose_alliance', C.sarah), actorId: C.alexandre, state: palmiersAtGarden() };

  it('issue du catalogue, distribution normalisée, traçabilité', async () => {
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'evaluate',
          replies: [
            {
              outcome: 'accepted_conditional',
              distribution: [
                { outcome: 'accepted_conditional', p: 0.6 },
                { outcome: 'refused', p: 0.2 },
                { outcome: 'won', p: 0.9 },
              ],
            },
          ],
        },
      ],
    });
    const result = await model(llm).resolve(input);
    expect(result).toMatchObject({ outcome: 'accepted_conditional', policy: 'llm@1', rngDraw: null });
    expect(result.llmCallId).toEqual(expect.any(String));
    expect(result.distribution?.accepted_conditional).toBeCloseTo(0.75, 10);
    expect(result.distribution?.refused).toBeCloseTo(0.25, 10);
    expect(Object.keys(result.distribution ?? {})).toEqual(['accepted_conditional', 'refused']);
    expect(llm.requests[0]!.system.stable).toContain('Sarah');
  });

  it('issue hors de actionDef(...).outcomes ⇒ rejet', async () => {
    const llm = new FakeLLM({ rules: [{ purpose: 'evaluate', replies: [{ outcome: 'won' }] }] });
    const failure = await model(llm)
      .resolve(input)
      .catch((e: unknown) => e);
    expect((failure as DomainError).code).toBe('UNKNOWN_OUTCOME');
  });

  it('action hors catalogue ⇒ rejet sans appel', async () => {
    const llm = new FakeLLM();
    await expect(model(llm).resolve({ ...input, option: option('teleport', C.sarah) })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(llm.requests).toHaveLength(0);
  });
});

describe('LlmDialogue', () => {
  const opt = option('propose_alliance', C.sarah);
  const verdict = (coherent: boolean, reason = 'ok') => ({ coherent, reason });
  const dialogue = (llm: FakeLLM) => new LlmDialogue({ llm, persona: personaOf });

  it('tours alternés, volume de l’action, vérification réussie du premier coup', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'speak', replies: [speakReply(), speakReply({ text: 'Pourquoi pas.', wantsToContinue: false })] },
        { purpose: 'verify', replies: [verdict(true)] },
      ],
    });
    const result = await dialogue(llm).generate(dialogueInput(palmiersAtGarden(), opt, 'accepted'));
    expect(result.mode).toBe('dialogue');
    expect(result.utterances.map((u) => [u.speakerId, u.addresseeIds[0], u.volume])).toEqual([
      [C.alexandre, C.sarah, 'whisper'],
      [C.sarah, C.alexandre, 'whisper'],
    ]);
    expect(result.verification).toEqual({
      verified: true,
      attempts: 1,
      fallback: false,
      reasons: [],
      ignoredReveals: [],
    });
    expect(llm.requestsFor('verify')[0]!.tier).toBe('fast');
    // Le second locuteur a entendu la première réplique.
    expect(llm.requestsFor('speak')[1]!.system.variable).toContain('Alexandre : Sarah, on devrait faire équipe.');
  });

  it('s’arrête à maxConversationTurns', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'speak', replies: [speakReply()] },
        { purpose: 'verify', replies: [verdict(true)] },
      ],
    });
    const state = palmiersAtGarden();
    const max = state.world.config.maxConversationTurns;
    const result = await dialogue(llm).generate(dialogueInput(state, opt, 'accepted'));
    expect(result.utterances).toHaveLength(max);
  });

  it('vérification en échec ⇒ régénération (avec la raison), puis succès', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'speak', replies: [speakReply({ wantsToContinue: false })] },
        { purpose: 'verify', replies: [verdict(false, 'Sarah refuse.'), verdict(true)] },
      ],
    });
    const result = await dialogue(llm).generate(dialogueInput(palmiersAtGarden(), opt, 'accepted'));
    expect(result.mode).toBe('dialogue');
    expect(result.verification).toMatchObject({ verified: true, attempts: 2, reasons: ['Sarah refuse.'] });
    expect(llm.requestsFor('speak')[1]!.messages[0]!.content).toContain('Sarah refuse.');
  });

  it('vérification toujours en échec ⇒ 3 générations puis repli sur un dialogue résumé', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'speak', replies: [speakReply({ wantsToContinue: false })] },
        { purpose: 'verify', replies: [verdict(false, 'Incohérent.')] },
      ],
    });
    const result = await dialogue(llm).generate(dialogueInput(palmiersAtGarden(), opt, 'accepted'));
    expect(llm.requestsFor('speak')).toHaveLength(3);
    expect(result.mode).toBe('summarized');
    expect(result.utterances).toHaveLength(1);
    expect(result.utterances[0]!.llmCallId).toBeNull();
    expect(result.verification).toMatchObject({ verified: false, attempts: 3, fallback: true });
    expect(result.verification!.reasons).toEqual(['Incohérent.', 'Incohérent.', 'Incohérent.']);
  });

  it('sortie inexploitable répétée ⇒ repli ; erreur de disponibilité ⇒ elle remonte', async () => {
    const broken = new FakeLLM({ rules: [{ purpose: 'speak', replies: ['n’importe quoi'] }] });
    const result = await dialogue(broken).generate(dialogueInput(palmiersAtGarden(), opt, 'accepted'));
    expect(result.mode).toBe('summarized');
    expect(result.verification!.fallback).toBe(true);

    const silent = new FakeLLM();
    await expect(dialogue(silent).generate(dialogueInput(palmiersAtGarden(), opt, 'accepted'))).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
    });
  });

  it('un fait inconnu cité par un locuteur est ignoré et consigné dans la vérification', async () => {
    const llm = new FakeLLM({
      rules: [
        { purpose: 'speak', replies: [speakReply({ reveals: [secret], wantsToContinue: false })] },
        { purpose: 'verify', replies: [verdict(true)] },
      ],
    });
    const result = await dialogue(llm).generate(dialogueInput(palmiersAtGarden(), opt, 'accepted'));
    expect(result.utterances[0]!.revealedFactIds).toEqual([]);
    expect(result.verification!.ignoredReveals).toEqual([secret]);
  });
});

describe('compileDirective', () => {
  it('ne garde que des actions du catalogue et des personnes connues, bornées', async () => {
    const llm = new FakeLLM({
      rules: [
        {
          purpose: 'compile_directive',
          replies: [
            {
              actions: { propose_alliance: 9, confront: -2, fly: 1 },
              targets: { Sarah: 1.2, Thomas: -1, Fantôme: 2 },
              prefer: ['join_activity', 'fly'],
              forbid: ['insult'],
            },
          ],
        },
      ],
    });
    const state = palmiersAtGarden();
    const ctx = buildAgentContext(state, C.alexandre, situationOf(state, C.alexandre));
    const biases = await compileDirective(llm, 'Allie-toi avec Sarah, méfie-toi de Thomas.', ctx);
    expect(biases).toEqual({
      actions: { propose_alliance: 3, confront: -2 },
      targets: { [C.sarah]: 1.2, [C.thomas]: -1 },
      prefer: ['join_activity'],
      forbid: ['insult'],
    });
  });
});
