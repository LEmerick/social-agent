# AI Reality World — Moteur de simulation (lib Node.js)

Document de conception · V0.1 · 2026-10-03

> Périmètre : **interpréter un personnage** (le transformer en agent) et **jouer des époques**.
> La narration et la génération vidéo sont hors périmètre. La lib produit l'Event Log qui les alimente.
> Le modèle de données est détaillé dans [`database-model.md`](./database-model.md).
> Schéma des services, interfaces et scénario de bout en bout : [`services.md`](./services.md).
> Catalogue d'actions, ordre du pipeline (action → issue → dialogue → vérification) et points d'ancrage du futur
> modèle de décision Monte Carlo : [`action-catalog.md`](./action-catalog.md). Il **prime** sur les §6, §7 et §9 ci-dessous.
> Objets, missions, équipes, votes et formats de saison : [`game-formats.md`](./game-formats.md).

---

## 1. Objectifs et non-objectifs

### Objectifs
1. Charger une fiche personnage (identité, traits, connaissances, objectifs, directives) et en faire un **agent** capable de décider et de parler.
2. Exécuter une **époque** complète : planification, déplacements, scènes, conversations, résolution, coûts, mémoire.
3. Produire un **Event Log immuable** à partir duquel tout l'état (stats, relations, scores) peut être recalculé.
4. Garantir l'**asymétrie d'information** : un personnage ne sait que ce qu'il a vu, entendu ou qu'on lui a rapporté.
5. Être **déterministe à graine égale**, aux réponses du LLM près (celles-ci sont enregistrées et rejouables).

### Non-objectifs (V1)
- Pas de rendu vidéo, d'assets visuels ni de voix (on stocke seulement les références `visual_profile_version`, `voice_id`).
- Pas d'UI. Pas de paiement réel : les crédits sont un registre comptable.
- Pas de simulation spatiale continue : le monde est un graphe de lieux.

---

## 2. Principes structurants

| Principe | Conséquence technique |
|---|---|
| **Simulation ≠ Narration ≠ Vidéo** | La lib ne connaît que la simulation. Elle expose des événements, jamais des scènes de montage. |
| **L'Event Log est la vérité** | Toute modification d'état passe par un `event` puis par des `effects`. Les tables d'état sont des projections. |
| **Le LLM interprète, les règles comptent** | Le LLM produit du texte et une **classification structurée** (intention, ton, issue). Les deltas numériques sont calculés par des règles versionnées. Le LLM n'attribue jamais de points. |
| **Présence exclusive** | À chaque instant (tick), un personnage est dans **exactement une** situation : une scène, un trajet, ou hors-jeu. |
| **Provenance de l'information** | Chaque connaissance indique sa source : témoin direct, rapportée par X, déduite, publique. |
| **Traits stables, humeur volatile** | Les traits ne changent pas pendant une époque. L'humeur et les émotions changent à chaque interaction. |

---

## 3. Vue d'ensemble des modules

```
@ai-reality/engine
├── core/            types du domaine, ids, horloge, RNG à graine
├── character/       CharacterSpec → AgentProfile (validation, compilation du prompt de persona)
├── world/           lieux, graphe de déplacements, règles de saison
├── knowledge/       faits, croyances, provenance, filtre de visibilité
├── memory/          souvenirs, saillance, consolidation, recherche (vectorielle optionnelle)
├── agent/           runtime de l'agent : plan(), chooseAction(), speak(), react(), reflect()
├── epoch/           scheduler, boucle de ticks, formation des scènes
├── interaction/     déroulé d'une conversation (tours de parole, fin de conversation)
├── resolution/      classification → règles → effects (relations, stats, scores)
├── economy/         coûts, crédits, machine d'état de survie
├── events/          event store, bus d'événements, projections
└── ports/           interfaces : StoragePort, LLMPort, EmbeddingPort, ClockPort
```

### Ports et adaptateurs

La lib ne dépend d'aucune base de données ni d'aucun fournisseur LLM précis.

```ts
interface LLMPort {
  complete<T>(req: { system: string; messages: Msg[]; schema?: JSONSchema; temperature?: number }): Promise<LLMResult<T>>;
}

interface StoragePort {
  tx<T>(fn: (s: StorageTx) => Promise<T>): Promise<T>;
  // repositories : characters, epochs, scenes, presence, events, effects,
  // relationships, knowledge, memories, ledger, snapshots
}

interface EmbeddingPort { embed(texts: string[]): Promise<number[][]> }
```

Adaptateurs fournis :
- `@ai-reality/storage-prisma` (cible production : Prisma + PostgreSQL + `pgvector`, voir `database-prisma.md`),
- `@ai-reality/storage-memory` (tests et prototypage),
- `@ai-reality/llm-anthropic` (Claude), plus un `ReplayLLM` qui rejoue les réponses enregistrées.

---

## 4. API publique (esquisse)

```ts
import { createWorld } from '@ai-reality/engine';

const world = await createWorld({
  storage: prismaStorage(prisma),   // PrismaClient fourni par l'application
  llm: anthropicLLM({ model: 'claude-sonnet-5-5' }),
  seed: 'season-1',
  config: { ticksPerEpoch: 32, tickMinutes: 30, maxConversationTurns: 8 },
});

// 1. Interpréter un personnage
const alex = await world.characters.create(spec);        // valide + compile le profil d'agent
await world.characters.setDirective(alex.id, {
  mode: 'directive',
  text: 'Rapproche-toi de Sarah, évite les conflits avec Thomas.',
});

// 2. Jouer une époque
const run = world.epochs.run({ number: 14 });
run.on('scene.opened',      e => {});
run.on('utterance',         e => {});
run.on('effect.applied',    e => {});
run.on('character.status',  e => {});
const result = await run.done;   // { epochId, events, summaryByCharacter }

// 3. Lire l'état
await world.characters.state(alex.id, { epoch: 14 });
await world.relationships.between(alex.id, sarah.id);
await world.knowledge.of(alex.id, { about: sarah.id });
await world.events.list({ epoch: 14, minImportance: 0.6 }); // entrée du Narrative Engine
```

### `CharacterSpec`

```ts
interface CharacterSpec {
  identity: { firstName; lastName; age; gender; origin; backstory; physical; voice; outfit };
  traits: Record<TraitKey, number>;          // 0..100 : charisma, ambition, empathy, loyalty,
                                             // impulsivity, manipulation, sociability, competitiveness
  knowledge?: { facts: FactSeed[] };         // secrets privés, savoirs initiaux
  goals: GoalSpec[];                         // main | secondary | social | private ; origine player|ai
  autonomy: 'autonomous' | 'guided' | 'directive';
  visual?: { profileVersion: number; referenceImages: string[]; voiceId?: string; wardrobeId?: string };
}
```

La compilation (`character/compile.ts`) produit un `AgentProfile` :
- un **persona prompt** stable et mis en cache (identité, traits traduits en tendances comportementales, style de parole),
- des **poids de décision** dérivés des traits (ex. `impulsivity` → probabilité de réagir à chaud, `loyalty` → bonus aux options qui servent un allié),
- les objectifs normalisés.

---

## 5. Le temps : époques, ticks et présence

Une **époque** = une journée simulée, découpée en **ticks** (par défaut 32 ticks de 30 min, de 8 h à 24 h).
Des **créneaux** peuvent être fixés par la saison (repas collectif, activité, annonce, cérémonie).

À chaque tick, chaque personnage actif occupe **un seul** segment de présence :

| Type | Signification |
|---|---|
| `scene` | Présent dans une scène (un lieu, un ensemble de personnes, une plage de ticks) |
| `transit` | En déplacement entre deux lieux (durée issue du graphe des lieux) |
| `offstage` | Hors-jeu : sommeil, restriction, pause, élimination |

```
tick:        0    4    8    12   16   20   24   28   32
Alexandre:   [scene S1 cuisine][tr][scene S4 jardin    ][tr][scene S9 salon]
Sarah:       [scene S1 cuisine][scene S2 cuisine  ][tr][scene S4 jardin][off]
Thomas:      [off][tr][scene S3 piscine                ][scene S9 salon    ]
```

**Une scène** est une unité de co-présence : un lieu et une plage de ticks pendant laquelle un groupe de personnages peut interagir. Quand quelqu'un entre ou sort, on **ne ferme pas** la scène : on ajoute ou on clôt un segment de présence. Une scène se ferme quand elle est vide ou quand le créneau se termine.

Chaque personnage possède donc une **timeline** complète et vérifiable :
« époque 14 → scène S4 (jardin, ticks 10-18) → présents : Alexandre, Sarah, puis Léa à partir du tick 14 ».

---

## 6. Déroulé d'une époque

```
┌──────────────┐  ┌────────────┐  ┌──────────────────────────────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐
│ 1. Init      │→ │ 2. Plan    │→ │ 3. Boucle de ticks               │→ │ 5. Coûts │→ │ 6. Mémoire│→ │ 7. Clôture│
│ charger état │  │ agenda/agent│ │  a. déplacements                 │  │ ledger   │  │ réflexion │  │ snapshot  │
│ snapshot N-1 │  │            │  │  b. formation/màj des scènes     │  │ survie   │  │ croyances │  │ events    │
└──────────────┘  └────────────┘  │  c. sélection des interactions   │  └──────────┘  └──────────┘  └───────────┘
                                  │  d. conversations (LLM)          │
                                  │  e. 4. résolution → effects      │
                                  │  f. propagation de l'information │
                                  └──────────────────────────────────┘
```

### Phase 1 — Initialisation
Chargement, pour chaque personnage `active` ou `restricted`, du snapshot de fin d'époque N-1 : stats, humeur, relations, crédits, objectifs, directive courante. Création de la ligne `epoch` (statut `running`) et d'un **RNG à graine** `hash(seed, epochNumber)`.

### Phase 2 — Planification
Chaque agent reçoit son contexte filtré (§8) et produit un **agenda** structuré (sortie JSON validée) :

```json
{ "intentions": [
    { "kind": "talk_to", "target": "sarah", "goal": "propose_alliance", "priority": 0.9 },
    { "kind": "avoid",   "target": "thomas", "priority": 0.6 },
    { "kind": "attend",  "activity": "pool_challenge", "priority": 0.5 } ],
  "mood_forecast": "confiant" }
```

L'agenda est une **intention**, pas un script : il oriente les choix de lieu et d'interlocuteur à chaque tick. En mode `directive`, la directive du joueur est injectée en priorité haute. En mode `guided`, elle l'est en priorité moyenne.

### Phase 3 — Boucle de ticks

**a. Déplacements.** Chaque personnage libre choisit un lieu cible en fonction de son agenda, des créneaux imposés et des personnes qu'il croit y trouver (sa *croyance*, pas la vérité). Ce choix est fait par une fonction de score déterministe : un appel LLM par tick serait trop coûteux. Le trajet crée un segment `transit`.

**b. Scènes.** Les personnages présents dans le même lieu au même tick sont rattachés à la scène ouverte de ce lieu, ou à une nouvelle scène. Les lieux peuvent être subdivisés en **zones** (ex. coin du jardin) pour permettre les apartés. Un personnage dans le même lieu mais dans une autre zone devient un **observateur potentiel** (il voit sans entendre). Un jet de discrétion peut le faire passer en **écoute indiscrète**.

**c. Sélection des interactions** (le « directeur de scène »). Pour chaque scène, on calcule les paires ou groupes candidats :
`score = intention(initiateur→cible) + affinité/rivalité + impulsivité × tension + nouveauté`.
On retient au plus K interactions par scène et par tick, sans qu'un personnage soit engagé dans deux interactions à la fois.

**d. Conversation.** Voir §7.

**e. Résolution.** Voir §9. Les effects sont appliqués **immédiatement**, ce qui permet à une réaction au tick suivant de tenir compte d'une confiance qui vient de baisser.

**f. Propagation.** Les participants et les témoins reçoivent des connaissances (§8). Une information sensible peut alimenter une **intention différée** (« raconter à Léa »), ajoutée à l'agenda de celui qui l'a apprise. C'est le mécanisme des chaînes A→B→C→D.

### Phase 4 (intégrée) — Événements collectifs
Les créneaux de saison (repas, défi, annonce) ouvrent une scène imposée avec tous les participants concernés. Le défi est résolu par des règles (traits + énergie + RNG), puis les réactions sont générées.

### Phase 5 — Coûts et survie
Écriture dans le **ledger** : entretien de base, activités suivies, actions spéciales, interventions joueur. Calcul `C_fin = C_début − Σ débits + Σ crédits`. Transition de la machine d'état (§10).

### Phase 6 — Mémoire et réflexion
Pour chaque personnage : sélection des événements vécus les plus saillants, création des souvenirs (résumé à la première personne, émotion, saillance), puis une **réflexion** LLM de fin de journée qui met à jour croyances et objectifs (« je pense que Sarah me cache quelque chose »). Les croyances issues de la réflexion sont stockées comme connaissances de type `inferred`.

### Phase 7 — Clôture
Snapshot des stats, humeur et relations de chaque personnage, recalcul des scores de l'époque, statut `epoch = completed`. Émission de `epoch.completed`. Le Narrative Engine peut alors lire les événements.

**Reprise sur erreur** : chaque tick est une transaction. Une époque interrompue reprend au dernier tick validé (`epoch.last_committed_tick`). Les réponses LLM étant enregistrées dans `llm_call`, on peut rejouer sans les régénérer.

---

## 7. Conversation : A parle à B

```
interaction_started(alexandre → sarah, scene S4, tick 11)
  loop (max N tours, ou jusqu'à ce qu'un agent choisisse "end")
    agent(locuteur).speak(contexte) → { text, intent, tone, emotion, wants_to_continue }
    observateurs à portée → reçoivent l'énoncé (texte complet ou résumé selon la zone)
  evaluator(transcript) → classification structurée
  rules(classification, traits, relation) → effects
interaction_ended
```

**Contexte envoyé à l'agent** (construit par `agent/context.ts`) :
1. Persona (en cache).
2. État courant : humeur, énergie, objectifs du jour.
3. Relation **perçue** avec l'interlocuteur (sa propre vue, qui est orientée).
4. Souvenirs pertinents sur l'interlocuteur (top-k par saillance et similarité).
5. Connaissances **qu'il possède** sur les sujets en jeu (filtrées par provenance).
6. Situation : lieu, présents visibles, tours précédents.

**Sortie de `speak()`** (schéma JSON imposé) :
```json
{ "text": "Je pense qu'on devrait travailler ensemble pour éviter que Thomas prenne le contrôle.",
  "intent": "propose_alliance", "tone": "conspiratorial", "emotion": "hopeful",
  "reveals": [], "mentions": ["thomas"], "wants_to_continue": true }
```

Le champ `reveals` est central : si un agent divulgue un fait (`fact_id`), le moteur vérifie qu'il le **connaît** réellement, puis le transmet aux auditeurs avec la provenance `told_by`. Un agent ne peut pas divulguer ce qu'il ne sait pas. S'il invente, c'est enregistré comme **rumeur** (un nouveau fait avec `truth = false`).

**Évaluateur** : un appel LLM distinct, à basse température, qui lit le transcript et renvoie uniquement des catégories issues d'un vocabulaire fermé :
```json
{ "outcome": "alliance_proposed_conditional", "acts": ["proposal", "trust_condition"],
  "per_participant": { "sarah": { "stance": "receptive_wary", "felt": "flattered" },
                       "alexandre": { "felt": "hopeful" } },
  "conflict_level": 0, "secrets_revealed": [] }
```

---

## 8. Connaissances, croyances et provenance

- Un **fait** est une proposition sur le monde : `(sujet, prédicat, objet)` + vérité objective + événement d'origine.
  Ex. `sarah — allied_with — lea` (vrai), `thomas — criticized — sarah` (vrai).
- Une **connaissance** est la relation d'un personnage à un fait : `source_type` (`witnessed`, `overheard`, `told`, `inferred`, `public`, `seeded`), `told_by`, événement de transmission, confiance (0..1), croyance (`believes`, `doubts`, `disbelieves`).
- Les connaissances s'enchaînent : `parent_knowledge_id` permet de remonter la chaîne « Léa le tient de Sarah, qui le tient d'Alexandre ».

**Règle d'or** : le constructeur de contexte d'un agent n'interroge **que** la table `knowledge` filtrée sur ce personnage, jamais `fact` directement. C'est ce filtre qui garantit l'asymétrie.

Confiance à la transmission : `conf_reçue = conf_émetteur × f(trust(récepteur→émetteur))`.

---

## 9. Résolution : de la classification aux effects

```
classification (LLM) ─┐
traits, humeur        ├─► rules engine (pur, versionné) ─► effects[] ─► projections
relation actuelle     ┘
```

Une **règle** associe une issue à des deltas modulés par les traits :

```ts
rule('alliance_proposed_conditional', ({ a, b, rel }) => [
  relDelta(b, a, 'trust',    +6 + b.traits.empathy / 25),
  relDelta(a, b, 'trust',    +4),
  relDelta(a, b, 'alliance', +15), relDelta(b, a, 'alliance', +10),
  statDelta(a, 'influence',  +3),
  moodDelta(a, 'hope', +0.3),
  score(a, 'social', 5), score(b, 'social', 3),
]);
```

Chaque `effect` référence l'`event_id` qui l'a causé et l'identifiant ou la version de la règle. On peut donc :
- **expliquer** chaque variation (« trust +8 parce que evt_0142, règle alliance_proposed@3 »),
- **recalculer** toutes les stats et tous les scores après un changement de règles (rejeu des events),
- interdire toute modification d'état hors d'un effect.

Les relations sont **orientées** : `trust(A→B) ≠ trust(B→A)`. C'est ce qui permet que Sarah interprète différemment la même conversation.

**Bornage** : toutes les dimensions sont clampées (0..100, ou −100..100 pour les dimensions bipolaires). Les deltas sont atténués par l'habituation : la n-ième flatterie de la journée rapporte moins.

---

## 10. Économie et survie

```
ACTIVE ──(crédits < seuil)──► RESTRICTED ──(échéance dépassée)──► ELIMINATION_PENDING ──(règle de saison)──► ELIMINATED
   ▲                              │
   └────(régularisation)──────────┘
```

- `RESTRICTED` : pas d'action spéciale, pas d'activité payante, la planification se limite aux interactions gratuites.
- Les transitions sont des **events** (`status_changed`) avec la règle appliquée. Elles ne sont jamais implicites.
- Les crédits achetés, les crédits gagnés et les scores restent des grandeurs séparées (colonne `source` du ledger).

---

## 11. Coût LLM et performance

Ordre de grandeur par époque pour P personnages : `P` (plan) + `Σ tours de conversation` + `nb interactions` (évaluateur) + `P` (réflexion).
Pour 12 personnages et environ 40 interactions de 6 tours : ≈ 12 + 240 + 40 + 12 ≈ **300 appels**.

Leviers :
- persona et règles du monde en **prompt caching**,
- déplacements et sélection d'interactions **sans LLM** (fonctions de score),
- interactions de faible importance prévue (`small_talk`) **résumées** en un seul appel au lieu d'un dialogue tour par tour,
- scènes indépendantes d'un même tick exécutées **en parallèle** (aucun personnage n'est partagé entre deux scènes),
- un modèle rapide (Haiku) pour l'évaluateur et le small talk, un modèle plus capable pour les conversations à fort enjeu.

### Traçabilité des appels LLM (table `llm_call`)

Schéma : [`05-evenements.prisma`](../packages/storage-prisma/prisma/schema/05-evenements.prisma) (modèle `LlmCall`) : objectif (`plan`, `speak`,
`evaluate`, `reflect`), modèle, `prompt_hash` (indexé, clé des cassettes), requête et réponse complètes, jetons
(entrée, sortie, cache) et latence.

Elle sert au rejeu déterministe (`ReplayLLM`), au suivi des coûts et au débogage du comportement des agents.

---

## 12. Tests

- **Unitaires** : règles (pures), machine d'état de survie, filtre de connaissances, formation des scènes, invariants de présence.
- **Scénarios** avec `ReplayLLM` : rejouer l'exemple A→B→C→D et vérifier la chaîne de provenance et l'inversion alliance → rivalité.
- **Propriétés** : à tout tick, chaque personnage a exactement un segment de présence ; la somme des effects d'un personnage est égale à son snapshot ; le rejeu de l'event log reproduit l'état.

---

## 13. Feuille de route

> Remplacée par [`implementation-plan.md`](./implementation-plan.md) (jalons M0 à M10, avec les tests). Le tableau ci-dessous est conservé pour mémoire.

| Jalon | Contenu |
|---|---|
| M1 | Types du domaine, `storage-memory`, compilation de personnage, schéma Postgres |
| M2 | Époque sans LLM (agents scriptés) : ticks, déplacements, scènes, présence, ledger |
| M3 | Agents LLM : plan, speak, évaluateur, règles, effects |
| M4 | Connaissances et provenance, propagation, intentions différées |
| M5 | Mémoire et réflexion, snapshots, rejeu et reprise |
| M6 | Export Event Log pour le Narrative Engine, CLI de simulation |

## 14. Questions ouvertes

1. Granularité du tick (30 min ?) et nombre de personnages visés par monde (10 ? 50 ?).
2. Le joueur peut-il intervenir **pendant** une époque, ou seulement entre deux époques ?
3. Le public (votes) est-il simulé par la lib ou injecté de l'extérieur entre deux époques ?
4. Un personnage peut-il vivre dans plusieurs mondes ou saisons (versionnage du personnage) ?
5. Langue des dialogues : uniquement le français, ou multilingue par personnage ?
