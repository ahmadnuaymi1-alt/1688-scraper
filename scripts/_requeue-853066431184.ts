/**
 * Re-queue the most recent failed job for 853066431184. Probe just confirmed
 * the URL now returns a real 665 KB body via Bright Data; the previous
 * attempts hit a dead-offer / robots-blocked phase that's no longer active.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();
(async () => {
  const failed = await prisma.scrapeJob.findFirst({
    where: {
      sourceUrl: "https://detail.1688.com/offer/853066431184.html",
      status: "failed",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!failed) {
    console.log("No failed job found for this URL");
    process.exit(0);
  }
  await prisma.scrapeJob.update({
    where: { id: failed.id },
    data: { status: "queued", startedAt: null, completedAt: null, errorMessage: null },
  });
  console.log(`Re-queued ${failed.id}  (was failed at ${failed.updatedAt.toISOString()})`);
  await prisma.$disconnect();
})();
