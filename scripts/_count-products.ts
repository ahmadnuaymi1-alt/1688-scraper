/**
 * Count every product in the DB. Read-only.
 *   npx tsx scripts/_count-products.ts
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

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.product.findMany({
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  process.stdout.write(`Total products: ${rows.length}\n\n`);
  let leadingModernMinimalist = 0;
  let leadingModern = 0;
  let leadingMinimalist = 0;
  let chineseTitle = 0;
  const HAN = /[㐀-鿿]/;
  for (const r of rows) {
    const t = (r.title || "").trim();
    if (/^modern\s+minimalist\b/i.test(t)) leadingModernMinimalist++;
    if (/^modern\b/i.test(t)) leadingModern++;
    if (/^minimalist\b/i.test(t)) leadingMinimalist++;
    if (HAN.test(t)) chineseTitle++;
  }
  process.stdout.write(`Titles starting with "Modern Minimalist": ${leadingModernMinimalist}\n`);
  process.stdout.write(`Titles starting with "Modern": ${leadingModern}\n`);
  process.stdout.write(`Titles starting with "Minimalist": ${leadingMinimalist}\n`);
  process.stdout.write(`Titles still in Chinese: ${chineseTitle}\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
