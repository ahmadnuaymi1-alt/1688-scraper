/** Count scrape jobs + products per offer id for the duplicate-prone URLs. Read-only. */
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

const OFFER_IDS = ["992555936024", "896517611488", "632542663860", "900845831775", "853066431184"];

(async () => {
  const p = new PrismaClient();
  for (const oid of OFFER_IDS) {
    const jobs = await p.scrapeJob.findMany({
      where: { sourceUrl: { contains: `/offer/${oid}.` } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, status: true, createdAt: true,
        product: { select: { id: true, title: true } },
      },
    });
    console.log(`\noffer ${oid}: ${jobs.length} job(s)`);
    for (const j of jobs) {
      const age = Math.round((Date.now() - new Date(j.createdAt).getTime()) / 60000);
      console.log(`  ${j.status.padEnd(14)} ${age}m  job=${j.id}  ${j.product ? `prod=${j.product.id} :: ${(j.product.title ?? "").slice(0, 45)}` : "no-product"}`);
    }
  }
  await p.$disconnect();
})();
