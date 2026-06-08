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
const PID = process.argv[2];
async function main() {
  if (!PID) throw new Error("usage: _speedtest-delete-product.ts <productId>");
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({ where: { id: PID }, select: { title: true, scrapeJobId: true } });
  if (!p) { console.log("not found (already gone)"); await prisma.$disconnect(); return; }
  // delete children explicitly in case cascade isn't configured, then the product + its job
  await prisma.productImage.deleteMany({ where: { productId: PID } });
  await prisma.variant.deleteMany({ where: { productId: PID } });
  await prisma.product.delete({ where: { id: PID } });
  if (p.scrapeJobId) { try { await prisma.scrapeJob.delete({ where: { id: p.scrapeJobId } }); } catch { /* may cascade */ } }
  console.log(`deleted product ${PID} ("${p.title}")`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
