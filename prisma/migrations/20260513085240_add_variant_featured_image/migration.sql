-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "featuredImageId" TEXT;

-- CreateIndex
CREATE INDEX "Variant_featuredImageId_idx" ON "Variant"("featuredImageId");

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_featuredImageId_fkey" FOREIGN KEY ("featuredImageId") REFERENCES "ProductImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
