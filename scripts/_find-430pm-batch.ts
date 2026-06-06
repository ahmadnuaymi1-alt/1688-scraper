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
(async () => {
  const p = new PrismaClient();
  // Find products with createdAt at 16:30 local (= 20:30 UTC if EDT). Search wider — 20:00 to 21:00 UTC.
  const since = new Date("2026-06-02T19:00:00Z");
  const until = new Date("2026-06-02T22:00:00Z");
  const prods = await p.product.findMany({
    where: { createdAt: { gte: since, lt: until } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true, createdAt: true },
  });
  console.log(`Products with createdAt between ${since.toISOString()} and ${until.toISOString()}:\n`);
  for (const pr of prods) {
    const local = new Date(pr.createdAt.getTime()).toString().slice(0, 25);
    console.log(`  ${pr.createdAt.toISOString()} (${local})  ${pr.id}  ${(pr.title ?? "").slice(0, 60)}`);
  }
  await p.$disconnect();
})();
