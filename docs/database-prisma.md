# AI Reality World — Intégration Prisma

Document de conception · V0.1 · 2026-10-03

> Complète [`database-model.md`](./database-model.md), qui décrit les intentions et les contraintes du modèle.

---

## Organisation

```
packages/storage-prisma/prisma/schema/
├── 00-base.prisma … 08-formats.prisma   # un fichier par bloc : modèles, relations, index, enums
└── migrations/
    ├── <horodatage>_init/               # généré par Prisma
    └── <horodatage>_constraints/        # SQL écrit à la main (créé avec --create-only)
```

Les commandes Prisma prennent toujours `--schema prisma/schema` (dossier de schéma).

La lib expose un adaptateur `@ai-reality/storage-prisma` qui implémente `StoragePort` à partir d'un
`PrismaClient` fourni par l'application. La lib ne crée pas elle-même de connexion.

## Ce que Prisma gère nativement
- Modèles, clés étrangères, index composites, `@@unique`, enums (`status`, `kind`, `role`, `source_type`…).
- `Json` pour `payload`, `classification`, `mood`, `scores`, `config`. `String[]` pour `uuid[]` et `text[]`.
- Transactions interactives `prisma.$transaction(async tx => …)` : une transaction par tick (voir l'architecture, §6).
- Identifiants : `@id @db.Uuid` avec une valeur générée côté application (uuid v7, ordonné dans le temps).

## Ce qui passe par migration SQL manuelle

| Besoin | Raison | Solution |
|---|---|---|
| Exclusion de chevauchement sur `presence` | Pas de `EXCLUDE` dans Prisma | `CREATE EXTENSION btree_gist` + `ALTER TABLE presence ADD CONSTRAINT … EXCLUDE USING gist (…)` |
| `CHECK` (bornes 0..100, cohérence `kind`/`scene_id`) | Pas de `CHECK` dans Prisma | `ALTER TABLE … ADD CONSTRAINT … CHECK (…)` |
| `memory.embedding vector(1024)` + index HNSW | Type non supporté | Champ `Unsupported("vector(1024)")?` dans le schéma ; paquet npm `pgvector` + `$queryRaw` / `$executeRaw` ; index HNSW créé en SQL |
| Append-only sur `event`, `effect`, `utterance`, `credit_ledger` | Droits SQL | `REVOKE UPDATE, DELETE … FROM ai_reality_app` (aussi sur `decision`) |
| `event.seq` identity | Pas d'`IDENTITY` explicite | `BigInt @default(autoincrement())` suffit |
| Chaîne de provenance (CTE récursive) | Pas de requête récursive | `$queryRaw` typé, encapsulé dans le repository `knowledge` |

Prisma ignore ces objets lors de l'introspection. Il ne les supprime pas lors des migrations suivantes, mais
`prisma migrate diff` peut les signaler : il faut garder la migration `constraints` idempotente
(`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` avant `ADD`).

## Où trouver quoi

| Besoin | Fichier |
|---|---|
| Générateur, source de données, extensions `vector` et `btree_gist` | `00-base.prisma` |
| Enums (statuts, rôles, sources de connaissance…) | `01-enums.prisma` |
| Exemple de modèle à relations nommées multiples vers `Character` | `Relationship` et `Knowledge` (`06-relations.prisma`, `07-connaissances.prisma`) |
| Champ non supporté par Prisma | `Memory.embedding Unsupported("vector(1024)")?` (`07-connaissances.prisma`) |
| `CHECK`, `EXCLUDE`, HNSW, GIN, rôle append-only | migration `constraints` |


## Points d'attention
- **Relations multiples vers `Character`** : `Relationship`, `Effect`, `Knowledge` (`characterId`, `toldById`) et `Fact`
  référencent `Character` plusieurs fois. Chaque relation doit être nommée (`@relation("…")`).
- **Self-relations** : `Event.causedByEventId` et `Knowledge.parentKnowledgeId` sont des relations sur le même modèle, à nommer également.
- **Volume d'écriture** : les `effect` d'une interaction sont insérés avec `createMany`. La mise à jour des projections
  (`relationship`, `character_state`) utilise `update` avec `{ increment }`, puis un clamp applicatif. Le `CHECK` SQL sert de filet de sécurité.
- **Axes de saison (`extraAxes`)** : Prisma ne sait pas incrémenter une clé JSON. On fait la lecture et la modification
  dans la transaction du tick (déjà sérialisée par personnage), ou un `$executeRaw` avec `jsonb_set` si besoin.
- **pgvector** : on utilise le paquet npm `pgvector` (`import pgvector from 'pgvector'`, puis `pgvector.toSql(embedding)`)
  dans des `$executeRaw` / `$queryRaw` encapsulés dans le repository `memory`. Pas de LangChain : la table `memory`
  garde ses clés étrangères vers `character` et `event`.
  ```ts
  await prisma.$queryRaw`SELECT id, summary FROM memory WHERE character_id = ${characterId}::uuid
    ORDER BY embedding <=> ${pgvector.toSql(queryEmbedding)}::vector LIMIT ${k}`;
  ```
- **Tests** : l'adaptateur `storage-memory` reste utile pour les tests unitaires. Les tests d'intégration tournent sur un Postgres
  jetable (Testcontainers), avec `prisma migrate deploy`.
