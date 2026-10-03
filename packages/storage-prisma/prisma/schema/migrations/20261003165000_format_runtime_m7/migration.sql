-- Suivi des formats de jeu sans table propre (M7) : historique d'actions et présences communes, lus par le DSL.

-- CreateTable
CREATE TABLE "format_runtime" (
    "season_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "format_runtime_pkey" PRIMARY KEY ("season_id")
);

-- AddForeignKey
ALTER TABLE "format_runtime" ADD CONSTRAINT "format_runtime_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
