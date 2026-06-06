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
  for (const id of ["cmpvdvrbu00atw2hk09s9sds6","cmpvdv330000jtzr0x291djgp"]) {
    const prod = await p.product.findUnique({ where: { id } });
    const job = await p.scrapeJob.findFirst({ where: { product: { id } }, select: { id: true, sourceUrl: true, status: true, createdAt: true } });
    console.log(`\n${id}:`);
    console.log(`  product: ${prod ? "EXISTS" : "MISSING"}`);
    console.log(`  scrapeJob: ${job ? JSON.stringify(job) : "none with this productId"}`);
  }
  const all = await p.product.findMany({ orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, createdAt: true } });
  console.log(`\nLatest 12 products in DB right now:`);
  for (const pr of all) console.log(`  ${pr.createdAt.toISOString().slice(0, 19)}  ${pr.id}  ${(pr.title ?? "").slice(0, 40)}`);
  await p.$disconnect();
})();
