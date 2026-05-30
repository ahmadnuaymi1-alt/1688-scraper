/**
 * Read-only audit: scan the latest N products for
 *   (a) any literal "cm" (or "厘米") tokens in descriptionHtml, variant option
 *       values, supplierLabel1/2/3, productContext, optionNames, or tags
 *   (b) per-variant "What's Included" sub-lists in descriptionHtml — heuristic:
 *       an <h?>What's Included</h?> (or <strong>What's Included</strong>) block
 *       followed by 2+ "<strong>... Variant</strong>" or "<p><strong>... cm
 *       Variant</strong></p>" sub-headings before the next <h?>.
 *
 *   npx tsx scripts/_audit-cm-and-whatsincluded.ts [count]
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

const CM_RX = /\b(\d+(?:[.,]\d+)?\s*cm\b|厘米|\bcm\b)/gi;

function findCmHits(s: string | null | undefined): string[] {
  if (!s) return [];
  const hits = s.match(CM_RX);
  return hits ? Array.from(new Set(hits.map((h) => h.trim()))) : [];
}

interface VariantSubHeading {
  raw: string;
}

/**
 * Heuristic: look for the "What's Included" anchor in the HTML, then scan
 * forward to the next h2/h3 and collect any <strong> sub-headings whose text
 * looks like a per-variant label (contains "Variant", "Version", "Size", or
 * a known unit pattern).
 */
function findVariantSubsections(html: string | null | undefined): VariantSubHeading[] {
  if (!html) return [];
  const re = /What['’]s\s+Included/i;
  const m = html.match(re);
  if (!m || m.index === undefined) return [];
  const after = html.slice(m.index);
  // Cut at the next h2/h3 boundary so we only inspect the "What's Included" block.
  const nextH = after.search(/<\/?h[23][\s>]/i);
  const block = nextH > 0 ? after.slice(0, nextH) : after;
  const subs: VariantSubHeading[] = [];
  for (const sm of block.matchAll(/<strong>([^<]+)<\/strong>/gi)) {
    const txt = sm[1].trim();
    if (/what'?s\s+included/i.test(txt)) continue;
    if (
      /\bvariant\b|\bversion\b|\bsize\b|\b\d+\s*(cm|mm|in(?:ch)?|"|m\b)/i.test(txt)
    ) {
      subs.push({ raw: txt });
    }
  }
  return subs;
}

async function main() {
  const count = Number(process.argv[2]) || 10;
  const prisma = new PrismaClient();
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      take: count,
      include: {
        variants: { orderBy: { position: "asc" } },
      },
    });

    let cmTotal = 0;
    let variantBlockTotal = 0;
    for (const p of products) {
      const ownerCm = new Map<string, string[]>();

      const titleHits = findCmHits(p.title);
      if (titleHits.length) ownerCm.set("title", titleHits);

      const tagsHits = findCmHits(p.tags);
      if (tagsHits.length) ownerCm.set("tags", tagsHits);

      const optNamesHits = findCmHits(p.optionNames);
      if (optNamesHits.length) ownerCm.set("optionNames", optNamesHits);

      const descHits = findCmHits(p.descriptionHtml);
      if (descHits.length) ownerCm.set("descriptionHtml", descHits);

      const ctxHits = findCmHits(p.productContext);
      if (ctxHits.length) ownerCm.set("productContext", ctxHits);

      // Variant fields
      const variantCmRows: string[] = [];
      for (const v of p.variants) {
        const fields: Array<[string, string | null]> = [
          ["option1", v.option1],
          ["option2", v.option2],
          ["option3", v.option3],
          ["supplierLabel1", v.supplierLabel1],
          ["supplierLabel2", v.supplierLabel2],
          ["supplierLabel3", v.supplierLabel3],
          ["title", v.title],
        ];
        const rowHits: string[] = [];
        for (const [k, val] of fields) {
          const h = findCmHits(val);
          if (h.length) rowHits.push(`${k}=${val ?? ""}`);
        }
        if (rowHits.length) {
          variantCmRows.push(`  pos ${v.position} ${v.isHidden ? "[HIDDEN]" : ""}: ${rowHits.join(" | ")}`);
        }
      }

      const subs = findVariantSubsections(p.descriptionHtml);

      const anyFinding = ownerCm.size > 0 || variantCmRows.length > 0 || subs.length > 0;
      if (!anyFinding) continue;

      console.log(`\n=== ${p.id} — "${p.title.slice(0, 60)}" ===`);
      for (const [k, v] of ownerCm.entries()) {
        cmTotal += v.length;
        console.log(`  [cm in ${k}] ${v.join(" | ")}`);
      }
      if (variantCmRows.length > 0) {
        cmTotal += variantCmRows.length;
        console.log(`  [cm in variants]`);
        for (const row of variantCmRows) console.log(row);
      }
      if (subs.length > 0) {
        variantBlockTotal += subs.length;
        console.log(`  [What's Included sub-sections: ${subs.length}]`);
        for (const s of subs) console.log(`    - <strong>${s.raw}</strong>`);
      }
    }

    console.log(`\nTotals: ${cmTotal} cm-hit(s), ${variantBlockTotal} per-variant sub-section heading(s) across ${products.length} product(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
