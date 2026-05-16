/**
 * Re-applies the description rule on a product (bypassing the API/auth layer
 * by calling the service function directly) then grades the resulting HTML
 * against the user's new rule's hard requirements:
 *   - Single <h2> (no colon, no brand)
 *   - 3 <p> paragraphs
 *   - "What's Included" block
 *   - <h3>Benefits</h3>
 *   - <h3>Specifications</h3> + <table>
 *   - <h3>FAQ</h3>
 *   - No em dashes
 *   - No whole-<p> bold leak / no bold-after-<br>
 *
 * Usage: PRODUCT_ID=<cuid> npx tsx scripts/_audit-description.ts
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
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
  const productId = process.env.PRODUCT_ID || process.argv[2];
  if (!productId) {
    console.error("Usage: PRODUCT_ID=<cuid> npx tsx scripts/_audit-description.ts");
    process.exit(1);
  }
  const prisma = new PrismaClient();

  try {
    const before = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, descriptionHtml: true },
    });
    if (!before) {
      console.error(`Product ${productId} not found`);
      process.exit(1);
    }
    console.log(`Product: ${before.title.slice(0, 80)}`);
    console.log(`Before re-apply: ${before.descriptionHtml?.length ?? 0} chars`);

    console.log("\nRe-applying description rule (service-direct, bypasses auth)...");
    const { reapplyRules } = await import("../src/services/rule.service.js");
    const t0 = Date.now();
    await reapplyRules(productId, "description");
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const after = await prisma.product.findUnique({
      where: { id: productId },
      select: { descriptionHtml: true },
    });
    const html = after?.descriptionHtml ?? "";

    console.log("\n=== FIRST 1500 CHARS OF NEW DESCRIPTION ===");
    console.log(html.slice(0, 1500));
    console.log(`\n(total: ${html.length} chars)`);

    console.log("\n=== STRUCTURAL CHECKS ===");
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) {
      const txt = h2Match[1].replace(/<[^>]+>/g, "").trim();
      console.log(`  <h2>: "${txt}"`);
      if (txt.includes(":")) console.log("    ✗ contains a colon (rule forbids)");
      else console.log("    ✓ no colon");
    } else {
      console.log("  ✗ no <h2> found");
    }

    const pCount = (html.match(/<p[^>]*>/gi) || []).length;
    console.log(`  <p> count: ${pCount} (rule wants ≥3 intro paragraphs + per-Benefit + per-FAQ)`);

    const hasWhatsIncluded = /What['’]s Included/i.test(html);
    console.log(`  "What's Included" present: ${hasWhatsIncluded ? "✓" : "✗"}`);

    const hasUl = /<ul[^>]*>/i.test(html);
    console.log(`  <ul> present: ${hasUl ? "✓" : "✗"}`);

    const benefitsH3 = /<h3[^>]*>\s*Benefits\s*<\/h3>/i.test(html);
    console.log(`  <h3>Benefits</h3>: ${benefitsH3 ? "✓" : "✗"}`);

    const specsH3 = /<h3[^>]*>\s*Specifications\s*<\/h3>/i.test(html);
    console.log(`  <h3>Specifications</h3>: ${specsH3 ? "✓" : "✗"}`);

    const hasTable = /<table[^>]*>/i.test(html);
    console.log(`  <table> in specs: ${hasTable ? "✓" : "✗"}`);

    const faqH3 = /<h3[^>]*>\s*FAQ\s*<\/h3>/i.test(html);
    console.log(`  <h3>FAQ</h3>: ${faqH3 ? "✓" : "✗"}`);

    const emDash = html.includes("—");
    console.log(`  em dashes (—): ${emDash ? "✗ FOUND" : "✓ none"}`);

    const wholePBold = /<p>\s*<strong>[^<]*<br[^>]*>[^<]*<\/strong>\s*<\/p>/i.test(html);
    console.log(`  whole <p> wrapped in <strong>: ${wholePBold ? "✗ FOUND" : "✓ clean"}`);

    const doubleStrong = /<strong>[^<]+<\/strong>\s*<br[^>]*>\s*<strong>/i.test(html);
    console.log(`  text after <br> bolded: ${doubleStrong ? "✗ FOUND" : "✓ clean"}`);

    const allPass =
      !!h2Match &&
      pCount >= 3 &&
      hasWhatsIncluded &&
      hasUl &&
      benefitsH3 &&
      specsH3 &&
      hasTable &&
      faqH3 &&
      !emDash &&
      !wholePBold &&
      !doubleStrong;

    console.log(`\n${allPass ? "✓ ALL CHECKS PASSED" : "✗ ONE OR MORE CHECKS FAILED — see above"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
