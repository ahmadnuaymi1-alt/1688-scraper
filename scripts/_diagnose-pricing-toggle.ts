/**
 * Diagnose: did the user's scrapeOptions ACTUALLY say suggestedPricing=true
 * for the latest scrapes? Print recent jobs + their stored options snapshot.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

(async () => {
  const jobs = await prisma.scrapeJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      sourceUrl: true,
      status: true,
      options: true,
      createdAt: true,
      product: { select: { id: true, title: true } },
    },
  });
  for (const j of jobs) {
    let pricing = "?";
    if (j.options) {
      try {
        const o = JSON.parse(j.options);
        pricing = String(o?.suggestedPricing ?? "undefined");
      } catch {
        pricing = "JSON-PARSE-FAIL";
      }
    } else {
      pricing = "NO-OPTIONS";
    }
    const titleHead = (j.product?.title ?? "—").slice(0, 50);
    console.log(
      `${j.createdAt.toISOString()} | ${j.status.padEnd(8)} | suggestedPricing=${pricing.padEnd(9)} | ${j.product?.id ?? "no-product"} | ${titleHead}`,
    );
    console.log(`    URL: ${j.sourceUrl}`);
    if (j.options) {
      console.log(`    OPT: ${j.options.slice(0, 200)}${j.options.length > 200 ? "..." : ""}`);
    }
  }
  await prisma.$disconnect();
})();
