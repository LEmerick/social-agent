import { describe, expect, it } from 'vitest';
import { IDS } from '@ai-reality/testkit';
import { C, L, Z, go } from '../helpers/epoch-kit.js';
import { RevealingDialogue, knowledgeOf, option, runMini } from '../helpers/knowledge-kit.js';

const { alexandre, sarah, lea, thomas } = C;
const SECRET = IDS.facts.sarahSecret;

/** Alexandre, Sarah et Thomas au banc ; Léa à la piscine (même lieu, autre zone : observatrice). */
const GARDEN = {
  [alexandre]: { 0: go(L.jardin, Z.banc) },
  [sarah]: { 0: go(L.jardin, Z.banc) },
  [thomas]: { 0: go(L.jardin, Z.banc) },
  [lea]: { 0: go(L.jardin, Z.piscine) },
};

describe('propagation : faits révélés', () => {
  it('un chuchotement est transmis à l’adressé (told) et entendu par la zone (overheard), pas par l’observateur d’une autre zone', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [sarah]: { 0: option('share_secret', thomas, SECRET) } },
      outcomes: { share_secret: 'believed' },
    });
    const [told] = knowledgeOf(r.state, thomas, SECRET);
    expect(told).toMatchObject({ sourceType: 'told', toldById: sarah, parentKnowledgeId: IDS.knowledge.sarahSecret });
    const event = r.journal.events.find((e) => e.type === 'secret_shared');
    expect(told?.viaEventId).toBe(event?.id);
    expect(knowledgeOf(r.state, alexandre, SECRET)).toMatchObject([{ sourceType: 'overheard', toldById: sarah }]);
    expect(knowledgeOf(r.state, lea, SECRET)).toEqual([]); // Léa voit le banc, n'entend pas
    // Les faits et connaissances créés sont dans le lot du tick, donc en base.
    expect(r.state.knowledge[told?.id ?? '']).toEqual(told);
  });

  it('l’issue répercute la croyance du destinataire : doubted, disbelieved', async () => {
    for (const [outcome, belief] of [
      ['doubted', 'doubts'],
      ['disbelieved', 'disbelieves'],
      ['believed', 'believes'],
    ] as const) {
      const r = await runMini({
        destinations: GARDEN,
        actions: { [sarah]: { 0: option('share_secret', thomas, SECRET) } },
        outcomes: { share_secret: outcome },
      });
      expect(knowledgeOf(r.state, thomas, SECRET)[0]?.belief).toBe(belief);
    }
  });

  it('un énoncé qui révèle un fait inconnu de son locuteur est ignoré, journalisé, et n’apprend rien', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [alexandre]: { 0: option('small_talk', thomas) } },
      dialogue: new RevealingDialogue([SECRET]),
    });
    expect(knowledgeOf(r.state, thomas, SECRET)).toEqual([]);
    expect(knowledgeOf(r.state, alexandre, SECRET)).toEqual([]);
    const interaction = r.journal.interactions.find((i) => i.action === 'small_talk');
    expect(interaction?.classification).toMatchObject({
      facts: { ignored: [{ factId: SECRET, speakerId: alexandre, reason: 'unknown_to_speaker' }] },
    });
    // L'énoncé enregistré ne prétend plus révéler ce fait.
    expect(r.journal.utterances.every((u) => u.revealedFactIds.length === 0)).toBe(true);
  });

  it('un énoncé qui révèle un fait connu le transmet au volume de l’énoncé', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [sarah]: { 0: option('small_talk', thomas) } },
      dialogue: new RevealingDialogue([SECRET]),
    });
    expect(knowledgeOf(r.state, thomas, SECRET)).toMatchObject([{ sourceType: 'told', toldById: sarah }]);
    // small_talk est à volume normal : le voisin de zone entend, l'observatrice de la piscine ne fait que voir.
    expect(knowledgeOf(r.state, alexandre, SECRET)).toMatchObject([{ sourceType: 'overheard' }]);
    expect(knowledgeOf(r.state, lea, SECRET)).toEqual([]);
  });

  it('une prise de parole forte (provoke) est entendue de tout le lieu, autres zones comprises', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [sarah]: { 0: option('provoke', thomas) } },
      dialogue: new RevealingDialogue([SECRET]),
    });
    expect(knowledgeOf(r.state, lea, SECRET)).toMatchObject([{ sourceType: 'overheard', toldById: sarah }]);
  });
});

describe('propagation : rumeurs et mensonges', () => {
  it('spread_rumor crée un fait faux attribué à son inventeur, que la cible apprend', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [alexandre]: { 0: option('spread_rumor', thomas) } },
      outcomes: { spread_rumor: 'believed' },
    });
    const rumor = Object.values(r.state.facts).find((f) => !f.isTrue);
    expect(rumor).toMatchObject({
      isTrue: false,
      inventedById: alexandre,
      predicate: 'aurait trahi',
      objectId: thomas,
    });
    expect([alexandre, thomas]).not.toContain(rumor?.subjectId);
    const event = r.journal.events.find((e) => e.type === 'rumor_spread');
    expect(rumor?.originEventId).toBe(event?.id);
    // L'inventeur sait que c'est faux ; la cible y croit ; le chaînage part de l'inventeur.
    const mine = knowledgeOf(r.state, alexandre, rumor?.id ?? '')[0];
    expect(mine).toMatchObject({ sourceType: 'inferred', belief: 'disbelieves', confidence: 1 });
    const theirs = knowledgeOf(r.state, thomas, rumor?.id ?? '')[0];
    expect(theirs).toMatchObject({ sourceType: 'told', toldById: alexandre, belief: 'believes' });
    expect(theirs?.parentKnowledgeId).toBe(mine?.id);
  });

  it('lie crée un fait faux ; démasqué, il n’est pas cru', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [alexandre]: { 0: option('lie', thomas) } },
      outcomes: { lie: 'detected' },
    });
    const lie = Object.values(r.state.facts).find((f) => !f.isTrue);
    expect(lie).toMatchObject({ inventedById: alexandre, subjectId: alexandre, objectId: thomas });
    expect(knowledgeOf(r.state, thomas, lie?.id ?? '')[0]).toMatchObject({
      belief: 'disbelieves',
      toldById: alexandre,
    });
  });
});

describe('propagation : écoute indiscrète', () => {
  const eavesdrop = (outcome: string) =>
    runMini({
      destinations: GARDEN,
      actions: {
        [sarah]: { 0: option('share_secret', thomas, SECRET) },
        [lea]: { 0: option('eavesdrop', sarah) },
      },
      outcomes: { share_secret: 'believed', eavesdrop: outcome },
    });

  it('non détectée, l’observatrice d’une autre zone apprend le secret (overheard) par l’event d’écoute', async () => {
    const r = await eavesdrop('undetected');
    const heard = knowledgeOf(r.state, lea, SECRET);
    expect(heard).toMatchObject([
      { sourceType: 'overheard', toldById: sarah, parentKnowledgeId: IDS.knowledge.sarahSecret },
    ]);
    const event = r.journal.events.find((e) => e.type === 'eavesdropped');
    expect(heard[0]?.viaEventId).toBe(event?.id);
    const record = r.journal.interactions.find((i) => i.action === 'eavesdrop');
    expect(record?.participants).toContainEqual({ characterId: lea, role: 'eavesdropper' });
  });

  it('détectée, elle n’apprend rien et la confiance de la cible baisse', async () => {
    const quiet = await eavesdrop('undetected');
    const r = await eavesdrop('detected');
    expect(knowledgeOf(r.state, lea, SECRET)).toEqual([]);
    expect(r.journal.events.some((e) => e.type === 'eavesdrop_detected')).toBe(true);
    const trust = (state: typeof r.state) => state.relationships[`${sarah}>${lea}`]?.trust;
    expect(trust(r.state)).toBeLessThan(trust(quiet.state) ?? 0);
  });

  it('personne à écouter (aucune conversation ce tick) : rien n’est appris', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [lea]: { 0: option('eavesdrop', sarah) } },
      outcomes: { eavesdrop: 'undetected' },
    });
    expect(Object.values(r.state.knowledge).filter((k) => k.characterId === lea)).toEqual([]);
  });
});

describe('propagation : faits créés par les interactions', () => {
  it('les témoins qui entendent apprennent le contenu (witnessed), ceux qui voient seulement non', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [alexandre]: { 0: option('propose_alliance', sarah) } },
      outcomes: { propose_alliance: 'accepted' },
    });
    const fact = Object.values(r.state.facts).find((f) => f.predicate === 'a proposé une alliance à');
    expect(fact).toMatchObject({ subjectId: alexandre, objectId: sarah, isTrue: true, sensitivity: 2 });
    const who = (id: string) => knowledgeOf(r.state, id, fact?.id ?? '').map((k) => k.sourceType);
    expect(who(alexandre)).toEqual(['witnessed']);
    expect(who(sarah)).toEqual(['witnessed']);
    expect(who(thomas)).toEqual(['witnessed']); // même zone : il entend le chuchotement
    expect(who(lea)).toEqual([]); // autre zone : elle voit seulement
  });

  it('les interactions sans trace (small_talk) ne créent pas de fait', async () => {
    const r = await runMini({
      destinations: GARDEN,
      actions: { [alexandre]: { 0: option('small_talk', sarah) } },
    });
    expect(Object.keys(r.state.facts)).toEqual([SECRET]);
  });
});

describe('niveaux de connaissance dans une époque', () => {
  it('known_of → met à la première interaction, acquainted à la troisième', async () => {
    const talk = option('small_talk', sarah);
    const r = await runMini({
      destinations: GARDEN,
      actions: { [alexandre]: { 0: talk, 1: talk, 2: talk } },
    });
    const level = (a: string, b: string) => r.state.relationships[`${a}>${b}`]?.acquaintance;
    expect(level(alexandre, sarah)).toBe('acquainted');
    expect(level(sarah, alexandre)).toBe('acquainted');
    expect(r.state.relationships[`${alexandre}>${sarah}`]?.interactionCount).toBe(3);
    // Thomas n'a parlé à personne : il connaît les autres de nom seulement.
    expect(level(thomas, alexandre) ?? 'known_of').toBe('known_of');
  });
});
