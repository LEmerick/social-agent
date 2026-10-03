# AI Reality World — Modèle de décision

Document de conception · M9 · 2026-10-03

> Réalise ce que [`action-catalog.md`](./action-catalog.md) §5 et §9 annonçait : `UtilityDecisionPolicy`,
> `ProbabilisticOutcomeModel`, `MonteCarloDecisionPolicy`, options chiffrées pour le joueur et simulateur d'équilibrage.
> Code : `packages/engine/src/decision/model/` (export unique `decision/model/index.ts`) et `packages/engine/src/balance/`.
> Tout est pur et déterministe : le hasard vient du `Rng` injecté, jamais de `Math.random()`.

## 1. Vue d'ensemble

| Brique                      | Rôle                                                                        | `policy` tracée   |
| --------------------------- | --------------------------------------------------------------------------- | ----------------- |
| `UtilityDecisionPolicy`     | Choisit l'action : utilité par option, puis softmax                         | `utility@1`       |
| `ProbabilisticOutcomeModel` | Tire l'issue : logistique ordonnée sur l'arête cible → acteur et les traits | `probabilistic@1` |
| `MonteCarloDecisionPolicy`  | Choisit après avoir simulé des futurs (décisions à fort enjeu)              | `montecarlo@1`    |
| `optionsForPlayer`          | Tableau chiffré des options pour le mode directif                           | —                 |
| `simulateBalance`           | N saisons hors ligne, statistiques d'équilibrage                            | —                 |

Elles se branchent sans changer le flux ([`action-catalog.md`](./action-catalog.md) §4) : `DecisionPolicy.choose` →
`OutcomeModel.resolve` → dialogue → `resolveInteraction`. `distribution` et `rngDraw` sont renseignés partout, donc la
table `decision` garde la trace des probabilités et du tirage (rejeu, explicabilité, affichage au joueur).

## 2. Utilité d'une option

```
U(option) = base + traits + relation + objectifs + agenda + directive + issue espérée − coût − habituation − répétition
```

Chaque terme est lisible séparément (`utilityBreakdown`). Les profils par action sont dans `utility-profiles.ts`.

| Terme           | Calcul                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`          | Appétit de base de l'action (`small_talk` +0,6 … `steal` −1,2).                                                                                                                                                                                                                                                                                                        |
| `traits`        | Σ coefficient du profil × poids de décision **centré** (`2·(w − 0,5)`, de −1 à +1). Les poids viennent de `decisionWeights` (`reactivity`, `allyBonus`, `deceptionBias`, `cooperationBias`, `rivalryDrive`, `ambitionDrive`, `socialInitiative`, `influenceSeeking`) : un trait moyen n'oriente pas. Le repos ajoute 2,5 × fatigue.                                    |
| `relation`      | `rel` × affinité(acteur, cible) ∈ [−1, 1] (confiance, affection, alliance dans les deux sens, moins la rivalité) + `riv` × rivalité + `stranger` × (1 − familiarité) + `attr` × attirance + `ally` × `allyBonus` centré × (0,4 + 0,6 × proximité d'alliance). Rompre une alliance a `ally = −2,4` : la loyauté la rend très improbable, la déloyauté la rend possible. |
| `objectifs`     | Objectif ouvert dont la cible est la cible de l'option : +0,5 (+0,4 si l'action est de rivalité) ; objectif `main` et action ambitieuse : +0,25 ; borné à 1.                                                                                                                                                                                                           |
| `agenda`        | Intention `talk_to` vers la cible : + priorité ; `avoid` : − 1,5 × priorité ; `tell` (`share_secret` du bon fait) : + 2 × priorité.                                                                                                                                                                                                                                    |
| `directive`     | `DirectiveBiases` : `actions[a]` + `targets[t]` + 1 si `prefer`. `forbid` ⇒ utilité −∞ (probabilité 0, sauf si tout est interdit). Mode orienté : la personnalité peut l'emporter.                                                                                                                                                                                     |
| `issue espérée` | 1,2 × (1 − 0,5 × réactivité) × espérance de valence des issues (§4). L'impulsif ignore une partie du risque. Nul pour les actions à issue unique.                                                                                                                                                                                                                      |
| `coût`          | −0,06 × énergie × (1 + fatigue) ; −2 × crédits / solde.                                                                                                                                                                                                                                                                                                                |
| `habituation`   | −0,6 par répétition du jour (même acteur, action, cible), en écho de la règle `habituation@1`.                                                                                                                                                                                                                                                                         |
| `répétition`    | −1 × (1 − (écart − 1) / 6) si la même action vers la même cible a eu lieu 1 à 6 ticks plus tôt (`dailyCounts`, clé `actor\|action~last\|target`) : refaire tout de suite la même chose est le plus pénalisé. Sans effet sans cible.                                                                                                                                    |

Les options qui ne diffèrent que par le fait (`share_secret` × N faits) forment un **groupe** : elles partagent le même
calcul et pèsent ensemble comme une seule option (`− T·ln N`), sinon un personnage qui connaît beaucoup de faits ne
ferait que se confier.

### Destination

`chooseDestination` est une **fonction de score déterministe** (aucun tirage). Le personnage ne place les autres que
là où il les a vus : même lieu maintenant, sinon `locationId` de ses intentions d'agenda, sinon nulle part.

```
score(lieu) = Σ intentions talk_to/tell vers le lieu supposé de la cible : +2 × priorité (avoid : −2 × priorité)
            + Σ alliés crus sur place : +0,8 × affinité
            + présence des autres : (sociabilité − 0,5) × 0,4 + 0,3 × affinité − 0,5 × rivalité
            + rythme de la maison : (0,4 + 0,8 × sociabilité) × bruit(graine, lieu, tranche de 8 ticks)   [lieu privé × 0,3]
            + habitude personnelle : 0,4 × bruit(graine, personnage, lieu, tranche de 8 ticks)
            + inertie 0,5 (rester) + 1 si énergie < 25 et lieu privé − 0,2 × durée du trajet
```

Le « rythme » est le même pour tous : les sociables se retrouvent là où la vie de la maison se passe ; l'habitude
personnelle disperse les solitaires. Le meilleur lieu est choisi (égalités : identifiant croissant) ; c'est `stay` si
c'est le lieu courant.

## 3. Softmax et température

```
p_i = exp((U_i − U_max) / T) / Σ_j exp((U_j − U_max) / T)        T = 0,15 + 0,85 × impulsivité / 100
```

- Somme à 1, soustraction du maximum (pas de débordement) ; une utilité −∞ a une probabilité nulle.
- **T → 0 ⇒ le maximum** (les ex æquo se partagent le poids) : `temperature: { fixed: 0 }` rend le choix déterministe.
- **T élevé ⇒ uniforme** : l'impulsif disperse ses choix, le posé joue le meilleur.
- Le tirage est `sampleIndex(p, rng.next())` ; la valeur tirée est `rngDraw`.

## 4. Issues probabilistes

Les issues d'une action sont **ordonnées** de la plus favorable à la moins favorable (`ActionDef.outcomes`). Le score
de l'acteur est affine dans les axes de l'arête **cible → acteur** et dans les traits, puis réparti par une logistique ordonnée
(seuils `σ(t_k − s)`, mêmes seuils que `HeuristicOutcomeModel`) :

```
s = biais + c_trust·(trust−50)/50 + c_aff·affection/100 + c_riv·rivalry/100 + c_all·alliance/100
          + c_fear·fear/100 + c_resp·(respect−50)/50 + c_attr·attraction/100 + Σ c_trait·(trait−50)/50
P(pire que k) = σ(t_k − s)      t_k = ((n−2)/2 − k) × 1,2
```

Les coefficients (`probabilistic-coeffs.ts`) ont un **signe fixe par action** : plus de confiance ⇒ plus d'acceptation ;
plus de rivalité ⇒ moins ; `break_alliance` est l'inverse (une cible très attachée réagit mal) ; la menace profite de la
peur. La monotonie est donc garantie par construction et testée (P(issue la plus favorable) croît avec `s`).
Exemple : `propose_alliance` avec `trust(Sarah→Alexandre) = 30` donne 38 % `accepted` + 29 % `accepted_conditional`
(proche des 62 % d'action-catalog §9.2), 20 % `deflected`, 9 % `refused`, 4 % `backfired` ; à 70 de confiance, 72 % `accepted`.

La **valence** de chaque issue (`outcome-values.ts`, −1 à +1) sert à l'issue espérée de l'utilité et à définir le
**succès** (valence ≥ 0,5 : accepté, cru, gagné, non détecté, trouvé).

## 5. Monte Carlo

Pour chaque option candidate, N **rollouts** sur une copie du `SimState` (`cloneForRollout` : personnages, relations,
compteurs et connaissances recopiés ; monde, lieux, routes, faits partagés en lecture seule). Un rollout = un futur :

```
pas 0     issue tirée dans la distribution → resolveInteraction (les règles de la simulation, inchangées)
pas 1..h-1 le fait laissé par l'action circule ; les informés de seconde main peuvent confronter le sujet
```

- **Fait suivi** : le fait notable de l'action (`notableFact`), ou `option.factId` pour `share_secret`, `confront`,
  `accuse`. Il n'existe que si l'issue a « eu lieu » (accepté, cru, escaladé… pas un refus poli ni une esquive).
- **Propagation** le long des arêtes : un informé B raconte à C avec `p = σ(−1,5 + 0,03·trust(B→C) + 0,015·affection(B→C)
  - 0,01·alliance(B→C) − 2·loyauté(B)·alliance(B→source) + 0,45·sensibilité + 0,6·(sociabilité(B) − 50)/50)`. Chaque informé
    essaie une fois chaque ignorant, au pas qui suit celui où il a appris.
- **Réactions** : un informé de seconde main (ni le sujet, ni la cible directe) confronte le sujet avec la probabilité
  de la politique d'utilité rapide : `softmax([U(confront) + 0,8·sensibilité/3, 0], T)`. La confrontation passe par
  `resolveInteraction` et modifie donc les arêtes du rollout. Calculée une fois par estimation, sur l'état de départ.
- **Valeur** pour l'acteur A (`montecarlo-value.ts`), écart entre l'état final et l'état de départ :
  `V = (0,5+ambition)·Δinfluence + (0,3+ambition/2)·ΔS + (0,5+loyauté)·ΣΔalliance(A→X)/20 + (0,5+coopération)·ΣΔconfiance(X→A)/20
− (0,5+(1−compétitivité))·ΣΔrivalité(X→A)/20 + 0,02·Δmoral + 0,05·Δénergie − 5·[passage sous le seuil de restriction]`,
  `S` étant la somme pondérée des scores de la saison.
- **Horizon et rollouts selon les traits** : prévoyance = 0,5 manipulation + 0,3 ambition + 0,2 (100 − impulsivité) ;
  `horizon = 1 + ⌊prévoyance × 3,999 / 100⌋` (1 à 4) ; `rollouts` interpolé entre 60 et 400 selon la minutie
  (0,5 maîtrise de soi + 0,5 ambition). Alexandre (manipulateur ambitieux) : horizon 4, 307 rollouts ; Thomas (impulsif) :
  horizon 2, 238 rollouts — il n'anticipe pas la chaîne de fuite.
- **Sortie** (`OptionEstimate`) : `meanValue`, `risk` (écart-type), `pSuccess`, `pLoss` (P(valeur < 0)), `pLearn[X]`
  (P(X apprend le fait)), fréquence des issues. **Même graine ⇒ même distribution** (un tirage de `rng` seme les flux ;
  un flux par option).
- **Choix** (`MonteCarloDecisionPolicy`) : les 6 options d'utilité la plus haute sont simulées ; score =
  `(moyenne − 0,5·(1 − réactivité)·risque) / 5 + 0,5·U` ; softmax à la température de l'impulsivité. L'utilité garde dans
  le score la personnalité et la directive que la valeur ne voit pas. Les autres options ont une probabilité nulle.
- **Performance** : 500 rollouts d'horizon 4 ≈ 25–30 ms (budget : 50 ms). L'essentiel est `resolveInteraction` (≈ 35 µs).

### Exemple chiffré (action-catalog §9.2)

Avec les arêtes forcées à 0,62 (Sarah accepte), 0,55 (Sarah → Léa) et 0,30 (Léa → Thomas), 5 000 rollouts d'horizon 4 :

| Mesure                              | Théorie                    | Estimée (3 graines) |
| ----------------------------------- | -------------------------- | ------------------- |
| P(Thomas l'apprend)                 | 0,62 × 0,55 × 0,30 = 0,102 | 0,096 – 0,102       |
| P(Léa l'apprend)                    | 0,62 × 0,55 = 0,341        | 0,330 – 0,343       |
| P(succès)                           | 0,62                       | 0,614 – 0,629       |
| Valeur moyenne (Alexandre) / risque | —                          | ≈ +7,0 / ≈ 5,7      |

À horizon 2, P(Thomas l'apprend) = 0 : un impulsif ne voit pas la fuite.

## 6. Options chiffrées du mode directif

```ts
optionsForPlayer(state, actorId, options, rng, cfg?): PlayerOption[]
// { option, pSuccess, meanValue, risk, pLoss, pLearn: { [personnage]: p }, outcomes, rollouts, horizon, utility }
```

Les 12 options d'utilité la plus haute sont simulées (`maxCandidates`), puis triées par valeur moyenne décroissante. Le
tableau correspond à celui d'action-catalog §9.2 (P(succès), valeur moyenne, P(« Thomas l'apprend »)) ; `utility` dit
ce que le personnage ferait de lui-même, ce qui permet d'afficher aussi la probabilité de désobéissance. La fonction
ne dépend ni du joueur ni de l'interface : `PlayerDecisionPolicy` l'appelle et gère délai et repli.

## 7. Simulateur d'équilibrage

`simulateBalance({ seasons, epochs, newSeason })` joue N saisons sans LLM : `AgendaDecisionPolicy(UtilityDecisionPolicy)`
et `ProbabilisticOutcomeModel`, scheduler + `interactionHook` + `economyHook` (les `elimination_pending` sont éliminés au
règlement suivant). Le moteur ne dépend d'aucun stockage : l'appelant fournit un monde frais par saison
(`createMemoryStorage()` + `seedWorld`, graine différente par saison). Le rapport :

| Mesure                                      | Sens                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `meanSurvivalEpochs`, `eliminationRate`     | Époques jouées avant élimination (plafonnée à `epochs`), part des éliminés               |
| `betrayals`, `betrayalRate`                 | `break_alliance` non esquivée, ou confrontation qui démasque un traître, par interaction |
| `finalCredits`                              | Moyenne, min, max en fin de saison                                                       |
| `actionDistribution`, `outcomeDistribution` | Part de chaque action et de chaque issue                                                 |

Exemple (2 saisons de 4 époques, Palmiers) : ≈ 390 interactions, `small_talk` 23 %, `request_favor` 9 %,
`propose_alliance` 8 %, `share_secret` 8 %, issues `accepted` 51 %, aucune élimination (entretien de 10 pour 100 crédits).
Le coût d'une époque croît avec le journal du monde (hors périmètre du modèle de décision).

## 8. Paramètres

| Paramètre                                    | Défaut                 | Effet                                                                 |
| -------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| `temperature.min` / `max` / `fixed`          | 0,15 / 1,0 / —         | Température = `min + (max − min) × réactivité` ; `fixed: 0` ⇒ maximum |
| `utility.outcomeWeight`                      | 1,2                    | Poids de l'issue espérée                                              |
| `utility.habituationPenalty`                 | 0,6                    | Pénalité par répétition du jour                                       |
| `utility.repetitionPenalty`                  | 1                      | Pénalité d'une répétition immédiate, décroît sur 6 ticks              |
| `rollouts`, `horizon`                        | selon les traits       | Imposent le plan Monte Carlo                                          |
| `minRollouts` / `maxRollouts` / `maxHorizon` | 60 / 400 / 4           | Bornes du plan                                                        |
| `maxCandidates`                              | 6 (choix), 12 (joueur) | Options réellement simulées                                           |
| `riskAversion`                               | 0,5                    | Aversion au risque × (1 − réactivité)                                 |
| `priorWeight` / `valueScale`                 | 0,5 / 5                | Poids de l'utilité et échelle des valeurs dans le score               |
| `overrides.outcome` / `tell` / `react`       | —                      | Imposent des probabilités (tests, exemple chiffré)                    |

## 9. Limites

- Les coefficients et les profils sont des valeurs de départ, calibrées à la main sur Palmiers ; le simulateur
  d'équilibrage est fait pour les régler, pas pour les garantir.
- Un seul fait est suivi par rollout, appris directement par la cible seule (les témoins de la scène ne sont pas
  simulés) ; la seule réaction simulée est `confront` ; la confrontation n'applique pas la logique de traître de M4.
- Les positions des autres ne sont connues que par la co-présence et les derniers lieux vus de l'agenda : pas de
  mémoire spatiale plus fine. La destination ignore le sommeil (`offstage`).
- Le Monte Carlo n'est pas récursif : les réactions utilisent l'utilité rapide, jamais un autre Monte Carlo.
- Une option à fort enjeu mais d'utilité a priori basse peut ne pas être simulée (présélection par l'utilité).
- Les probabilités de propagation et de réaction sont indépendantes d'un pas à l'autre.
