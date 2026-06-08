-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "imageType" TEXT;

-- CreateIndex
CREATE INDEX "ProductImage_productId_imageType_idx" ON "ProductImage"("productId", "imageType");
