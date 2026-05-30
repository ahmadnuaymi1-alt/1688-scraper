/**
 * Inspect the latest N products to see what shape their descriptions and
 * variants are in. Read-only, no DB writes.
 *
 *   npx tsx scripts/_inspect-latest-two.ts [count]
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

const HAN = /[㐀-鿿]/;

async function main() {
  const count = Number(process.argv[2]) || 2;
  const prisma = new PrismaClient();
  const rows = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: count,
    include: {
      variants: { orderBy: { position: "asc" } },
    },
  });
  for (const r of rows) {
    console.log("=====", r.id, "|", r.title.slice(0, 60));
    const desc = r.descriptionHtml ?? "";
    const imgCount = (desc.match(/<img/gi) || []).length;
    const headingCount = (desc.match(/<h[123]/gi) || []).length;
    const liCount = (desc.match(/<li/gi) || []).length;
    const hasSpecs = /Specifications/i.test(desc);
    const hasFeatures = /Features/i.test(desc);
    console.log(`  desc: ${desc.length} chars, ${imgCount} <img>, ${headingCount} headings, ${liCount} <li>, specs=${hasSpecs}, features=${hasFeatures}`);
    console.log(`  desc head: ${desc.slice(0, 200).replace(/\s+/g, " ")}`);
    console.log(`  productContext present: ${!!r.productContext}, length: ${(r.productContext || "").length}`);
    if (r.productContext) {
      try {
        const ctx = JSON.parse(r.productContext);
        console.log(`    specs:${(ctx.extractedSpecs || []).length} callouts:${(ctx.featureCallouts || []).length} angles:${(ctx.marketingAngles || []).length} supplierAttrs:${(ctx.supplierAttributes || []).length}`);
      } catch {
        console.log("    ctx parse error");
      }
    }
    console.log(`  optionNames: ${r.optionNames}`);
    let chineseVariantCount = 0;
    for (const v of r.variants) {
      const blob = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      if (HAN.test(blob)) chineseVariantCount++;
    }
    console.log(`  variants: ${r.variants.length} (visible ${r.variants.filter((v) => !v.isHidden).length}), Chinese-text variants: ${chineseVariantCount}`);
    for (const v of r.variants.slice(0, 6)) {
      const blob = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      console.log(`    pos${v.position} hidden=${v.isHidden} → ${blob}`);
    }
    if (r.variants.length > 6) console.log(`    ... (${r.variants.length - 6} more)`);
    console.log("");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
