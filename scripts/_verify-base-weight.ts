/**
 * Run ONLY rewriteProductDescription (no rule application) and inspect the
 * resulting base description for a Weight row. This isolates whether the
 * injection into productContext succeeded — independent of the rule's LLM
 * output behavior.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PRODUCT_ID = process.argv[2] ?? "cmpspc34s00j0w24c40x2tikh";

async function main() {
  const { rewriteProductDescription } = await import("../src/services/description-enrichment.service");
  const prisma = new PrismaClient();

  console.log(`Product: ${PRODUCT_ID}`);
  console.log(`Calling rewriteProductDescription()…`);
  const r = await rewriteProductDescription(PRODUCT_ID);
  console.log(`hadCachedContext: ${r.hadCachedContext}, descriptionHtml length: ${r.descriptionHtml.length}`);

  console.log(`\n--- descriptionHtml ---\n${r.descriptionHtml}`);

  const tableMatch = r.descriptionHtml.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) { console.log("\nNo <table> in descriptionHtml"); await prisma.$disconnect(); return; }

  const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const weightRows = rows.filter((m) => /weight/i.test(m[0]));
  console.log(`\nWeight rows (${weightRows.length}):`);
  for (const w of weightRows) console.log(w[0]);

  const passes = weightRows.some((w) => /\d.*\bg\b/i.test(w[0]));
  console.log(`\nWeight row contains grams? ${passes ? "✓ YES" : "✗ NO"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
