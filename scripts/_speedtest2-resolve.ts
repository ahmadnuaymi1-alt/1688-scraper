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
const URL = process.argv[2];
async function main() {
  if (!URL) throw new Error("usage: _speedtest2-resolve.ts <url>");
  const prisma = new PrismaClient();
  const job = await prisma.scrapeJob.findFirst({ where: { sourceUrl: URL }, orderBy: { createdAt: "desc" } });
  if (!job) throw new Error("no job for " + URL);
  const product = await prisma.product.findUnique({ where: { scrapeJobId: job.id } });
  if (!product) throw new Error("no product for job " + job.id);
  // single line: "<productId> <jobId>"
  process.stdout.write(`${product.id} ${job.id}\n`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
