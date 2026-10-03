-- Un slug de zone est unique dans son lieu ; un fait appartient à un monde existant.

-- CreateIndex
CREATE UNIQUE INDEX "location_zone_location_id_slug_key" ON "location_zone"("location_id", "slug");

-- AddForeignKey
ALTER TABLE "fact" ADD CONSTRAINT "fact_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
