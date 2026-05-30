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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
(async () => {
  const p = new PrismaClient();
  const offerId = process.argv[2] ?? "744712282137";
  const job = await p.scrapeJob.findFirst({
    where: { sourceUrl: { contains: offerId } },
    select: { id: true, sourceUrl: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log("ScrapeJob:", job);
  if (job) {
    const prods = await p.product.findMany({
      where: { scrapeJobId: job.id },
      select: { id: true, title: true, createdAt: true },
    });
    console.log("Products from that job:", JSON.stringify(prods, null, 2));
  }
  await p.$disconnect();
})();
