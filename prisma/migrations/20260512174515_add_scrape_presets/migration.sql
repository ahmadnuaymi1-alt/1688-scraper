-- CreateTable
CREATE TABLE "ScrapeOptionPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapeOptionPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeOptionPreset_userId_idx" ON "ScrapeOptionPreset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapeOptionPreset_userId_name_key" ON "ScrapeOptionPreset"("userId", "name");

-- AddForeignKey
ALTER TABLE "ScrapeOptionPreset" ADD CONSTRAINT "ScrapeOptionPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
