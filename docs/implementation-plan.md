# AI Reality World — Plan d'implémentation du moteur

Document de travail · V0.1 · 2026-10-03

> S'appuie sur : [`engine-architecture.md`](./engine-architecture.md) · [`database-model.md`](./database-model.md) ·
> [`database-prisma.md`](./database-prisma.md) · [`services.md`](./services.md) · [`action-catalog.md`](./action-catalog.md) ·
> [`game-formats.md`](./game-formats.md). Remplace la feuille de route de `engine-architecture.md` §13.

---

## 1. Principes de construction

1. **Le moteur tourne sans LLM avant d'en avoir un.** Les jalons M2 à M4 utilisent des agents scriptés (`ScriptedDecisionPolicy`).
   Le LLM arrive en M5, branché sur des interfaces déjà testées.
2. **Le cœur est pur.** Règles, préconditions, coûts, conditions de mission et formation des scènes sont des fonctions
   `(SimState, input, rng) → résultat`. Elles sont testées sans base ni réseau.
3. **Chaque jalon se termine par un scénario exécutable** sur le monde de test « Maison des Palmiers » (§3).
4. **Pas de jalon sans ses tests.** La définition de « terminé » (§6) s'applique à chaque tâche.
5. **Tout est rejouable.** Graine + journal des événements + cassettes LLM ⇒ même résultat.

---

## 2. Stack et organisation du dépôt

| Sujet | Choix |
|---|---|
| Langage | TypeScript 5 strict, ESM, Node 22 LTS |
| Monorepo | pnpm workspaces + Turborepo |
| Base | PostgreSQL 16 + `pgvector` + `btree_gist`, Prisma 6, paquet npm `pgvector` |
| Validation aux frontières | Zod (`CharacterSpec`, `SeasonFormat`, sorties LLM) |
| Tests | Vitest · fast-check (propriétés) · Testcontainers (Postgres) · cassettes LLM maison |
| LLM | SDK Anthropic (`claude-sonnet-5-5` pour les dialogues, `claude-haiku-4-5` pour la vérification et le small talk) |
| Qualité | ESLint, Prettier, `tsc --noEmit`, couverture via `@vitest/coverage-v8` |
| CI | GitHub Actions : lint → typecheck → unit → intégration (service Postgres) → scénarios (cassettes) |

```
packages/
├── engine/                 # @ai-reality/engine : domaine, services, scheduler (aucune dépendance base/LLM)
│   ├── src/
│   │   ├── core/           # ids, Rng, Clock, types, erreurs
│   │   ├── state/          # SimState, chargement, clone
│   │   ├── rules/          # règles pures, catalogue d'actions, issues
│   │   ├── character/  world/  scene/  agent/  interaction/  resolution/
│   │   ├── relationship/  knowledge/  memory/  economy/  scoring/  events/
│   │   ├── formats/        # format, inventory, mission, team, vote
│   │   ├── decision/       # DecisionPolicy, OutcomeModel (scripted, llm, utility, montecarlo)
│   │   └── epoch/          # EpochScheduler
│   └── tests/              # unit/, property/, scenario/
├── storage-memory/         # StoragePort en mémoire (tests)
├── storage-prisma/         # StoragePort Prisma + prisma/schema.prisma + migrations
├── llm-anthropic/          # LLMPort Claude
├── testkit/                # fixtures, builders, FakeLLM, ReplayLLM, cassettes, assertions
├── cli/                    # ai-reality run-epoch | replay | inspect
└── narrative/              # @ai-reality/narrative (M10)
```

Règle : `engine` ne dépend d'aucun autre paquet du dépôt. Les adaptateurs dépendent d'`engine`, et `testkit` est une dépendance de développement uniquement.

---

## 3. Monde de test partagé : « Maison des Palmiers »

Fourni par `@ai-reality/testkit`, utilisé par tous les tests de scénario.

| Élément | Contenu |
|---|---|
| Lieux | cuisine, jardin (zones `banc` et `piscine`), salon, chambres, confessionnal + routes (1 à 2 ticks) |
| Personnages | **Alexandre** (ambition 90, manipulation 80, loyauté 40) · **Sarah** (empathie 65, secret à protéger) · **Léa** (alliée secrète de Sarah) · **Thomas** (compétitivité 85, rival d'Alexandre) |
| État initial | `trust(Sarah→Alexandre) = 30`, `alliance(Sarah↔Léa) = 80`, 100 crédits chacun |
| Format | `villa` (par défaut) et `adventure` (M7) |
| Graine | `palmiers-test` |

Builders : `aWorld().withCharacters(…).build()`, `aCharacter('alexandre').withTrait('loyalty', 10)`, `aSimState()…`.

---

## 4. Jalons

Durées indicatives pour une personne à temps plein. Chaque jalon liste ses livrables, ses tests et son critère de sortie.

### M0 — Socle (2 j)
**Livrables**
- Monorepo, tsconfig strict, ESLint, Vitest, Turborepo, CI GitHub Actions.
- `core/` : `Id` (uuid v7), `Rng` à graine (`hash(seed, epoch, tick, characterId)`), `Clock`, `Result`/erreurs typées.
- `testkit/` vide mais branché.

**Tests**
- `rng.spec` : même graine ⇒ même suite ; graines dérivées indépendantes ; distribution uniforme (test du χ² sur 10⁵ tirages).
- CI verte sur une PR vide.

**Sortie** : `pnpm build && pnpm test` passe en local et en CI.

---

### M1 — Domaine, schéma et stockage (5 j)
**Livrables**
- Types du domaine et schémas Zod : `CharacterSpec`, `SeasonFormat`, `ActionDef`, `Effect`, `Event`…
- `prisma/schema.prisma` complet : toutes les tables de `database-model.md` et de `game-formats.md`, plus `decision` et `llm_call`.
- Migration `0002_constraints` : exclusion de chevauchement sur `presence`, `CHECK`, index HNSW, `REVOKE UPDATE/DELETE` sur les tables append-only.
- `StoragePort` + `storage-memory` + `storage-prisma` (repositories).
- `CharacterService.create/compile`, `WorldService`, chargement du `SimState`.

**Tests**
- *Unitaires* : validation Zod (traits hors 0..100 rejetés, autonomie inconnue rejetée) ; `compile()` produit un persona stable (snapshot) et des poids de décision attendus.
- *Contrat de stockage* : **une même suite** `storageContract(factory)` exécutée sur `storage-memory` **et** `storage-prisma`, pour garantir que les deux adaptateurs se comportent pareil.
- *Intégration Postgres* (Testcontainers) :
  - deux segments de `presence` qui se chevauchent pour un même personnage ⇒ rejet (contrainte d'exclusion) ;
  - `trust = 120` ⇒ rejet (`CHECK`) ;
  - `UPDATE event` avec le rôle applicatif ⇒ refusé ;
  - `prisma migrate deploy` sur base vide puis `migrate diff` ⇒ aucune dérive.

**Sortie** : le monde « Maison des Palmiers » se crée en base et se recharge en `SimState` à l'identique (test aller-retour).

---

### M2 — Époque sans LLM : temps, déplacements, scènes (6 j)
**Livrables**
- `EpochScheduler` : phases 1 à 7 (les phases encore vides sont des stubs), boucle de ticks, une transaction par tick, `last_committed_tick`.
- `SceneService` : déplacements via les routes, formation et fermeture des scènes, zones, `audience()` (portée selon volume et zone).
- `ScriptedDecisionPolicy` : agendas et destinations définis dans le test.
- Bus d'événements de l'`EpochRun` (`scene.opened`, `phase.started`…).

**Tests**
- *Unitaires* : `audience()` (un murmure n'est entendu que dans la zone ; un observateur d'une autre zone voit sans entendre) ; formation des scènes (deux personnages au même lieu ⇒ même scène ; arrivée en cours ⇒ nouveau segment, la scène reste ouverte).
- *Propriétés* (fast-check, mondes et agendas aléatoires) :
  - à chaque tick, chaque personnage actif a **exactement un** segment de présence ;
  - aucun trou sur `[0, ticksPerEpoch)` ;
  - un trajet dure exactement `travel_ticks` ;
  - une scène fermée n'a plus de présence ouverte.
- *Reprise* : interruption au tick 17 (exception injectée) ⇒ `resume()` repart au tick 17 et produit la même timeline qu'une exécution sans interruption.
- *Scénario* `timeline.scenario` : la timeline d'Alexandre correspond à l'exemple de `engine-architecture.md` §5.

**Sortie** : une époque complète de 4 personnages scriptés en moins de 1 s sur `storage-memory`.

---

### M3 — Résolution, relations, économie, scores (6 j)
**Livrables**
- Catalogue d'actions V1 + vocabulaire d'issues (`action-catalog.md` §2-3), préconditions pures.
- `InteractionEngine` (sans LLM) : sélection des interactions, pipeline action → issue → (dialogue factice) → résolution.
- `ScriptedOutcomeModel` puis `HeuristicOutcomeModel` (logistique simple, à graine).
- `ResolutionEngine` : règles `(action, issue)` versionnées → effects ; habituation ; clamp.
- `EventStore.append/list/replay`, `RelationshipService` (colonnes + `extra_axes`, niveau de connaissance), `ScoringService`, `EconomyService` (ledger, machine d'état de survie), table `decision`.

**Tests**
- *Unitaires, règles* : un test par règle (table de cas : traits × relation ⇒ deltas attendus) ; habituation (la 3ᵉ flatterie rapporte moins) ; clamp aux bornes ; `extra_axes` borné.
- *Unitaires, économie* : `C_fin = C_début − Σ débits + Σ crédits` ; transitions `active → restricted → elimination_pending → eliminated` et régularisation ; en `restricted`, les actions payantes sont refusées.
- *Propriétés* :
  - **rejeu** : reconstruire `relationship` et `character_state` à partir des seuls effects ⇒ identiques aux projections ;
  - **déterminisme** : même graine ⇒ même journal d'événements (comparaison de hash) ;
  - aucune modification d'état sans `effect` associé (tous les champs projetés sont traçables jusqu'à un `event_id`).
- *Scénario* `alliance.scenario` : Alexandre propose une alliance à Sarah ⇒ `evt` `alliance_proposed`, effects attendus, `acquaintance` passe à `met`.

**Sortie** : époque scriptée complète avec résolution, ledger et snapshots ; `recompute()` après changement d'une règle met à jour les scores.

---

### M4 — Connaissances et propagation (4 j)
**Livrables**
- `KnowledgeService` : faits, transmission (`share_secret`, `spread_rumor`, `lie`), confiance à la transmission, chaîne `parent_knowledge_id`, `provenance()` (CTE récursive).
- Témoins et écoute indiscrète (`eavesdrop`) via `audience()`.
- Intentions différées : une information sensible ajoute « raconter à X » à l'agenda.
- Constructeur de contexte d'agent qui **ne lit que `knowledge`**.

**Tests**
- *Unitaires* : un agent ne peut pas révéler un fait qu'il ne connaît pas (rejet) ; une rumeur crée un `fact` faux avec `invented_by` ; `conf_reçue = conf_émetteur × f(trust)`.
- *Sécurité de l'information* (test critique) : pour chaque appel au constructeur de contexte d'un scénario complet, **aucun** fait absent de la table `knowledge` du personnage n'apparaît dans le contexte produit.
- *Scénario* `chain.scenario` : Alexandre → Sarah → Léa → Thomas ; `provenance(Thomas, F1)` renvoie la chaîne complète ; la confrontation de Thomas a lieu ; l'alliance devient une rivalité.

**Sortie** : la chaîne A→B→C→D de la spec émerge avec des agents scriptés et est traçable en base.

---

### M5 — Agents LLM (7 j)
**Livrables**
- `LLMPort`, `llm-anthropic` (prompt caching du persona), `FakeLLM` (réponses scriptées), `ReplayLLM` + enregistrement des cassettes (`llm_call`).
- `AgentRuntime` : `plan()`, `speak()` (sortie JSON validée par Zod, `reveals` contrôlé), `reflect()`.
- `LlmDecisionPolicy` et `LlmOutcomeModel` (choix **dans le catalogue** uniquement).
- Vérificateur : le dialogue aboutit-il à l'issue tirée ? Sinon régénération (2 essais max), puis repli sur un dialogue résumé.
- Compilation des directives en `biases`.

**Tests**
- *Unitaires avec `FakeLLM`* :
  - réponse JSON invalide ⇒ nouvel essai, puis erreur typée ;
  - action hors catalogue ⇒ rejet ;
  - `reveals` d'un fait inconnu ⇒ ignoré et journalisé ;
  - vérification en échec ⇒ régénération, puis repli.
- *Snapshot des prompts* : le contexte envoyé pour une situation donnée est figé (détecte les régressions de prompt).
- *Scénarios avec `ReplayLLM`* : `alliance.scenario` et `chain.scenario` rejoués avec des cassettes enregistrées ⇒ mêmes événements, sans réseau.
- *Évaluations live* (`pnpm test:live`, hors CI, nécessite une clé API) :
  - cohérence de persona : un personnage loyal trahit-il son allié moins souvent qu'un manipulateur ? (20 exécutions, seuil statistique) ;
  - taux de vérification réussie ≥ 90 % ;
  - coût et latence par époque mesurés et journalisés.

**Sortie** : une époque de 4 personnages joue avec de vrais dialogues ; son rejeu sans réseau est identique.

---

### M6 — Mémoire et réflexion (4 j)
**Livrables**
- `MemoryService` : création des souvenirs, saillance et décroissance, `recall()` par personnes concernées et par similarité (`pgvector` via `$queryRaw`), `EmbeddingPort`.
- Phase 6 : réflexion de fin de journée ⇒ croyances `inferred`, mise à jour des objectifs.

**Tests**
- *Unitaires* : décroissance de la saillance ; un souvenir rappelé remonte ; `recall` filtre bien par personnage (pas de fuite entre agents).
- *Intégration Postgres* : recherche vectorielle avec des embeddings factices déterministes ⇒ ordre attendu ; l'index HNSW est utilisé (`EXPLAIN`).
- *Scénario* : à l'époque 15, le contexte de Sarah contient le souvenir de la proposition d'Alexandre (époque 14).

**Sortie** : la continuité d'une époque à l'autre est vérifiée sur 3 époques enchaînées.

---

### M7 — Formats de jeu (8 j)
**Livrables**
- `FormatService` (chargement et validation de `SeasonFormat`, `scheduled_event`, déclencheurs via le DSL).
- DSL de conditions (`holds`, `knows`, `relationship`, `stat`, `action_done`, `present_with`, `vote_result`, combinateurs).
- `InventoryService` (placement, fouille, transferts, vol, faux objets, fait `holds()`), `MissionService`, `TeamService`, `VoteService`.
- Actions d'objet, de vote et d'espionnage au catalogue ; résolution collective des épreuves.
- Formats `villa` et `adventure`.

**Tests**
- *Unitaires, DSL* : table de cas par prédicat ; combinateurs ; conditions sur un `SimState` construit à la main.
- *Unitaires, objets* : la possession est toujours unique (porteur **ou** lieu) ; un vol non détecté ne crée pas de connaissance chez la victime ; un faux objet crée un fait faux.
- *Unitaires, votes* : décompte, égalité, révote ; le collier annule les votes contre son porteur ; vote du public injecté.
- *Propriétés* : sur des époques aléatoires, l'inventaire projeté est égal à l'inventaire rejoué depuis les events ; aucun objet ne disparaît ni n'est dupliqué.
- *Scénario* `necklace.scenario` (format `adventure`, cassettes) : la chasse au collier de `game-formats.md` §8, jusqu'à l'élimination de Thomas.
- *Scénario* `merge.scenario` : le déclencheur `count_active ≤ 10` fusionne les équipes.

**Sortie** : une saison `adventure` de 5 époques avec 8 personnages tourne de bout en bout.

---

### M8 — Robustesse, rejeu et outillage (4 j)
**Livrables**
- `EventStore.replay` complet et `recompute(rulesVersion)` ; détection des époques corrompues.
- CLI : `ai-reality run-epoch`, `replay`, `inspect character|scene|provenance`.
- Parallélisation des scènes indépendantes d'un même tick ; limites de débit et budget LLM par époque.
- Observabilité : métriques par phase, coût LLM par époque.

**Tests**
- *Rejeu de bout en bout* : une saison de 5 époques rejouée depuis le journal et les cassettes ⇒ état final identique (hash).
- *Parallélisme* : exécution parallèle et séquentielle ⇒ même journal d'événements (déterminisme préservé).
- *Chaos* : panne LLM, timeout Postgres ou kill du processus au milieu d'un tick ⇒ reprise correcte, aucun effect en double.
- *Benchmarks* (Vitest bench, suivis en CI) : époque scriptée de 12 personnages < 2 s ; ticks par seconde ; requêtes par tick.

**Sortie** : `ai-reality replay --season 1` reproduit exactement la saison.

---

### M9 — Modèle de décision (6 j) · rédaction de `decision-model.md`
**Livrables**
- `UtilityDecisionPolicy` (utilité + softmax, température liée à l'impulsivité), `ProbabilisticOutcomeModel` (logistiques sur les arêtes du graphe).
- `MonteCarloDecisionPolicy` : rollouts sur un `SimState` cloné avec les **mêmes règles pures** ; horizon et nombre de rollouts dépendants des traits.
- `PlayerDecisionPolicy` : options chiffrées pour le mode directif, délai et repli, probabilité de désobéissance.
- Simulateur d'équilibrage hors ligne : N saisons sans LLM ⇒ statistiques (durée moyenne de survie, taux de trahison…).
- Rédaction de `decision-model.md`.

**Tests**
- *Unitaires* : softmax (somme à 1, température → 0 ⇒ choix déterministe du max) ; logistiques monotones (plus de confiance ⇒ plus d'acceptation).
- *Statistiques* : sur 10⁴ tirages, les fréquences observées collent aux probabilités annoncées (χ², p > 0.01).
- *Monte Carlo* : sur l'exemple de `action-catalog.md` §9, l'estimation de « Thomas l'apprend » converge vers 0.62 × 0.55 × 0.30 ± 2 % ; même graine ⇒ même distribution.
- *Comportement* : un personnage loyal choisit `break_alliance` significativement moins souvent qu'un personnage déloyal.
- *Bench* : 500 rollouts d'horizon 4 < 50 ms.
- *Non-régression* : les scénarios M3, M4 et M7 passent avec `Utility` + `Probabilistic` à la place des implémentations scriptées ou LLM.

**Sortie** : les trois modes (autonome, orienté, directif) fonctionnent avec le modèle probabiliste ; le joueur voit les options chiffrées.

---

### M10 — Narration (8 j) · paquet `@ai-reality/narrative`
**Livrables** : `NarrativeEngine` (collecte, sélection avec quota de temps d'écran, arcs par `caused_by_event_id`), `WriterAgent`, `ConfessionalService`, `EpisodeValidator`, tables `episode_*`, export des fiches `Scene` pour le Video Engine.

**Tests**
- *Unitaires* : sélection (importance, quota par personnage joueur) ; regroupement en arcs.
- *Validateur* : un script qui cite un event inexistant, montre un personnage absent de la scène, ou contredit le journal ⇒ rejeté.
- *Confessionnal* : le contexte de l'interview ne contient que les connaissances du personnage (même test d'étanchéité qu'en M4).
- *Lecture seule* : le paquet n'a aucun droit d'écriture sur les tables de simulation (test de permissions SQL).
- *Scénario* : l'épisode 14 « l'alliance trahie » produit 4 scènes valides, avec sources.

---

## 5. Stratégie de test

### 5.1 Pyramide

| Niveau | Outil | Portée | Quand |
|---|---|---|---|
| Unitaires | Vitest | règles, DSL, Rng, audience, économie, softmax | chaque commit |
| Propriétés | fast-check | invariants de présence, rejeu, inventaire, déterminisme | chaque commit |
| Contrat de stockage | Vitest | même suite sur `storage-memory` et `storage-prisma` | chaque PR |
| Intégration | Testcontainers Postgres | contraintes, migrations, pgvector, CTE récursives, droits | chaque PR |
| Scénarios | testkit + `ReplayLLM` | histoires de bout en bout de la spec | chaque PR |
| Évaluations live | vrai LLM | cohérence de persona, taux de vérification, coûts | manuel ou nocturne |
| Benchmarks | Vitest bench | époque, rollouts, requêtes | chaque PR (alerte si régression > 20 %) |

### 5.2 Invariants vérifiés en continu

Exécutés par les tests de propriétés **et** par une assertion de fin d'époque en mode debug :

1. **Présence** : un segment et un seul par personnage actif et par tick, sans trou.
2. **Traçabilité** : chaque valeur projetée (relation, stat, crédit, possession, progression de mission) se reconstruit à partir des effects.
3. **Déterminisme** : graine + cassettes ⇒ même journal (hash).
4. **Étanchéité de l'information** : aucun contexte d'agent ne contient un fait absent de sa table `knowledge`.
5. **Bornes** : toutes les dimensions dans leurs intervalles.
6. **Unicité des objets** : un objet a au plus un emplacement, et le nombre d'objets est conservé hors événements de création ou de destruction.
7. **Append-only** : aucune ligne d'`event`, `effect`, `utterance`, `credit_ledger` ou `decision` n'est modifiée.

### 5.3 LLM en test

- **`FakeLLM`** : réponses scriptées par motif, pour les tests unitaires des chemins d'erreur.
- **`ReplayLLM`** : rejoue des cassettes indexées par `prompt_hash`. Une cassette manquante fait échouer le test, sauf avec `RECORD=1`.
- Les cassettes sont versionnées dans `packages/testkit/cassettes/`. Un changement de prompt invalide les cassettes concernées (le snapshot du prompt échoue d'abord, ce qui force une revue).

---

## 6. Définition de « terminé » (chaque tâche)

- [ ] Code typé strict, aucun `any` non justifié, fichiers de moins de 500 lignes.
- [ ] Tests unitaires de la logique ajoutée, et cas d'erreur couverts.
- [ ] Invariants du §5.2 toujours verts.
- [ ] Contrat de stockage vert sur les deux adaptateurs, si le stockage est touché.
- [ ] Couverture ≥ 90 % sur `rules/`, `decision/`, `formats/`, `knowledge/` ; ≥ 80 % ailleurs.
- [ ] Pas d'appel à `Math.random()` ni à `Date.now()` dans `engine` (règle ESLint).
- [ ] Doc concernée mise à jour si le comportement change.

---

## 7. Planning récapitulatif

| Jalon | Durée | Cumul | Démonstration |
|---|---|---|---|
| M0 Socle | 2 j | 2 j | CI verte |
| M1 Domaine & schéma | 5 j | 7 j | Monde créé en base, rechargé à l'identique |
| M2 Temps & scènes | 6 j | 13 j | Timeline d'une journée scriptée |
| M3 Résolution | 6 j | 19 j | Alliance résolue, rejeu des effects |
| M4 Connaissances | 4 j | 23 j | Chaîne A→B→C→D traçable |
| M5 Agents LLM | 7 j | 30 j | Vraie époque, rejeu sans réseau |
| M6 Mémoire | 4 j | 34 j | Continuité sur 3 époques |
| M7 Formats | 8 j | 42 j | Saison « aventure », chasse au collier |
| M8 Robustesse | 4 j | 46 j | Rejeu d'une saison, CLI |
| M9 Décision | 6 j | 52 j | Monte Carlo, options chiffrées pour le joueur |
| M10 Narration | 8 j | 60 j | Épisode 14 généré et validé |

Les jalons M6 et M7 sont indépendants l'un de l'autre et peuvent être menés en parallèle (deux développeurs, deux worktrees).
De même, M10 ne dépend que de M5 et peut démarrer plus tôt.

## 8. Risques

| Risque | Parade |
|---|---|
| Coût LLM par époque trop élevé | Small talk résumé, Haiku pour la vérification, budget par époque (M8), décisions sans LLM (M9) |
| Le LLM sort du catalogue ou contredit l'issue | Validation Zod, vérificateur, repli sur un dialogue résumé |
| Dérive entre le schéma Prisma et les migrations SQL manuelles | Test `migrate diff` en CI, migration `0002` idempotente |
| Tests de scénario fragiles | Cassettes et graines, assertions sur les events et effects plutôt que sur le texte |
| Performance du rejeu sur de longues saisons | Snapshots par époque, rejeu à partir du dernier snapshot |
