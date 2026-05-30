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

const p = new PrismaClient();

(async () => {
  const start = new Date("2026-05-24T00:00:00Z");
  const end = new Date("2026-05-25T00:00:00Z");
  const products = await p.product.findMany({
    where: {
      scrapeJob: { is: { createdAt: { gte: start, lt: end } } },
    },
    select: { id: true, title: true, scrapeJob: { select: { createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const r of products) {
    console.log(`${r.id} | ${r.scrapeJob?.createdAt.toISOString()} | ${(r.title ?? "").slice(0, 70)}`);
  }
  console.log(`COUNT: ${products.length}`);
  await p.$disconnect();
})();
