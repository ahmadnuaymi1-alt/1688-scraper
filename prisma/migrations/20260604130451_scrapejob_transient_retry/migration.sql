-- AlterTable
ALTER TABLE "ScrapeJob" ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ScrapeJob_status_scheduledAt_idx" ON "ScrapeJob"("status", "scheduledAt");
