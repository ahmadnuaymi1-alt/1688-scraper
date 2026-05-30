/**
 * Print the descriptionHtml of one product for visual inspection.
 *   npx tsx scripts/_peek-description.ts <productId>
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
  const r = await prisma.product.findUnique({ where: { id }, select: { id: true, title: true, descriptionHtml: true } });
  if (!r) { process.stdout.write("NOT FOUND\n"); process.exit(0); }
  process.stdout.write(`${r.id}\n  ${r.title}\n\n`);
  process.stdout.write(`--- descriptionHtml (${(r.descriptionHtml ?? "").length} chars) ---\n\n`);
  process.stdout.write((r.descriptionHtml ?? "(null)") + "\n");
  await prisma.$disconnect();
}

main().catch((e) => { process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n"); process.exit(1); });
