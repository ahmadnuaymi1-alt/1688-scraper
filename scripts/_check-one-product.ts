/**
 * Print variant + SKU state for a single product. Read-only.
 *   npx tsx scripts/_check-one-product.ts <productId>
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
  const id = process.argv[2];
  if (!id) { process.stderr.write("usage: <productId>\n"); process.exit(1); }
  const prisma = new PrismaClient();
  const r = await prisma.product.findUnique({ where: { id }, include: { variants: true } });
  if (!r) { process.stdout.write(`${id}: NOT FOUND\n`); process.exit(0); }
  const visible = r.variants.filter((v) => !v.isHidden);
  const blankSku = r.variants.filter((v) => !v.sku || v.sku.trim() === "").length;
  process.stdout.write(`${id}\n`);
  process.stdout.write(`  title: ${r.title.slice(0, 80)}\n`);
  process.stdout.write(`  variants: total=${r.variants.length}  visible=${visible.length}  hidden=${r.variants.length - visible.length}\n`);
  process.stdout.write(`  SKUs:     blank=${blankSku}  populated=${r.variants.length - blankSku}\n`);
  await prisma.$disconnect();
}
main().catch((e) => { process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n"); process.exit(1); });
