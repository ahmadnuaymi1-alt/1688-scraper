/**
 * Read-only diagnostic for the tag-rule source-URL bug.
 *
 * Reads:
 *   - The active tag-category TransformationRule(s) — to see what placeholder
 *     URL the rule prompt may be writing.
 *   - The latest N uploaded-to-Shopify products with their:
 *       * Product.tags (local DB)
 *       * ScrapeJob.sourceUrl (the *real* source URL)
 *       * UploadRecord.shopifyProductId (so we know what to PATCH later)
 *
 *   npx tsx scripts/_inspect-tags-bug.ts
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
  try {
    const tagRules = await prisma.transformationRule.findMany({
      where: { category: "tags" },
      orderBy: { updatedAt: "desc" },
    });
    console.log(`Tag rules: ${tagRules.length}`);
    for (const r of tagRules) {
      console.log(`  "${r.name}"  enabled=${r.enabled}`);
      console.log(`  config (first 800): ${r.config.slice(0, 800)}`);
      console.log();
    }

    // Find a 1688 URL in the rule prompt (the likely placeholder).
    const ruleUrls = new Set<string>();
    for (const r of tagRules) {
      const m = r.config.match(/https?:\/\/[^\s"',\\]+/g);
      if (m) for (const u of m) ruleUrls.add(u);
    }
    console.log(`URLs found in tag-rule prompts: ${Array.from(ruleUrls).join(", ") || "(none)"}`);
    console.log();

    const uploads = await prisma.uploadRecord.findMany({
      where: { status: "success" },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        product: {
          select: {
            id: true,
            title: true,
            tags: true,
            scrapeJob: { select: { sourceUrl: true } },
          },
        },
      },
    });
    console.log(`Latest ${uploads.length} successful Shopify uploads:\n`);

    let withUrlTag = 0;
    let withMismatchedUrlTag = 0;
    for (const u of uploads) {
      const tags = (u.product.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const urlTags = tags.filter((t) => /^https?:\/\//.test(t));
      const realSource = u.product.scrapeJob?.sourceUrl ?? null;
      const hasMismatch = urlTags.some((t) => t !== realSource);
      if (urlTags.length > 0) withUrlTag++;
      if (hasMismatch) withMismatchedUrlTag++;

      console.log(`[${u.product.id}] shopify=${u.shopifyProductId ?? "?"} "${u.product.title.slice(0, 60)}"`);
      console.log(`  real source : ${realSource ?? "(no scrapeJob)"}`);
      console.log(`  URL tags    : ${urlTags.join(" | ") || "(none)"}`);
      console.log(`  mismatch    : ${hasMismatch ? "YES" : "no"}`);
    }
    console.log(`\nSummary: ${uploads.length} uploads | ${withUrlTag} with a URL tag | ${withMismatchedUrlTag} with the WRONG URL`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
