/**
 * READ-ONLY: see what the user's "Rewrite description" rule did to
 * cmpjstyid + cmpjstlof. Specifically:
 *   - Is productContext.extractedSpecs still intact? (it should be — the
 *     rule only writes descriptionHtml)
 *   - What does descriptionHtml currently look like? (probably bare marketing
 *     copy with the per-style dim entries stripped out)
 *   - List the description-category TransformationRules for the user that
 *     owns these products so we can find the offending prompt.
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

async function main() {
  const prisma = new PrismaClient();
  let userId: string | null = null;
  for (const id of ["cmpjstyid007tw2ggulv0g8b3", "cmpjstlof005zw2ggy9gucyhh"]) {
    console.log(`\n=== ${id} ===`);
    const p = await prisma.product.findUnique({
      where: { id },
      select: { userId: true, title: true, descriptionHtml: true, productContext: true },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    if (p.userId && !userId) userId = p.userId;
    const ctx = p.productContext ? JSON.parse(p.productContext) : null;
    const specs = ctx?.extractedSpecs ?? [];
    console.log(`productContext.extractedSpecs: ${specs.length}`);
    for (const s of specs.slice(0, 30)) console.log(`  ${s.name}: ${s.value}`);
    console.log(`\ndescriptionHtml (${(p.descriptionHtml ?? "").length} chars):`);
    console.log(p.descriptionHtml?.slice(0, 1500) ?? "(empty)");
  }

  // List description-category rules for the user.
  if (userId) {
    console.log(`\n\n=== TransformationRules for userId=${userId} (category=description) ===`);
    const rules = await prisma.transformationRule.findMany({
      where: { userId, category: "description" },
      orderBy: { createdAt: "desc" },
    });
    for (const r of rules) {
      console.log(`\n--- Rule ${r.id} ---`);
      console.log(`name: ${r.name}`);
      console.log(`enabled: ${(r as { enabled?: boolean }).enabled ?? "?"}`);
      console.log(`config: ${r.config}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
