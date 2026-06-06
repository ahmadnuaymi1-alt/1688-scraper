/**
 * One-off: finish the jewellery-box children after the size split.
 * For each child (size detected from its variants' option1):
 *   - clean English interim title + handle (title rule refines later)
 *   - strip the redundant "N-layer " prefix from each variant option1 + title
 *   - set per-size weight on every variant (the scrape stamped a uniform 3300g)
 *   - patch rawPayload.price.min + productWeightG to the size's TRUE cost/weight
 *     so the landed-cost pipeline produces an accurate per-size COGS / 2x floor
 *   - write hero-overrides/<childId>.json (reuse the validated general prompt)
 *
 * All writes SEQUENTIAL (connection_limit=1). Pass --apply to write.
 *
 *   npx tsx scripts/_patch-jewelry-children.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

const CHILDREN: Record<string, number> = {
  cmpxx12260001w2yspsqfr94i: 2,
  cmpxx130y000hw2ys0d5ikvsb: 4,
  cmpxx161q001pw2ysta9lvk0k: 5,
  cmpxx1854002lw2ys7vdeln6v: 6,
  cmpxx19xo003dw2ysoykzsyhg: 7,
  cmpxx1auc003tw2ysfupa6ih9: 10,
};

// Per-size COGS model. CNY cost = the real per-SKU 1688 price for that tier.
// Weight = size-scaled estimate anchored on the scraped 3300g (= 4-layer); the
// listing gave only one product-level weight, so larger boxes are scaled up.
const SIZE_META: Record<number, { cnyCost: number; weightG: number; label: string }> = {
  2: { cnyCost: 199, weightG: 2300, label: "2-Layer" },
  4: { cnyCost: 199, weightG: 3300, label: "4-Layer" },
  5: { cnyCost: 229, weightG: 3800, label: "5-Layer" },
  6: { cnyCost: 229, weightG: 4500, label: "6-Layer" },
  7: { cnyCost: 269, weightG: 5200, label: "7-Layer" },
  10: { cnyCost: 269, weightG: 6500, label: "10-Layer" },
};

const stripLayer = (s: string) => s.replace(/^\s*\d+\s*-?\s*layer\s+/i, "").trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Reuse the validated general (non-lighting) hero prompt from the parent override.
const PARENT_OVERRIDE = path.resolve(process.cwd(), "hero-overrides/cmpxvghau000hw260fnktskfz.json");
const generalHeroPrompt: string = (() => {
  const j = JSON.parse(fs.readFileSync(PARENT_OVERRIDE, "utf-8")) as { heroPromptOverride: string };
  return j.heroPromptOverride;
})();

(async () => {
  for (const [cid, layers] of Object.entries(CHILDREN)) {
    const meta = SIZE_META[layers];
    const child = await prisma.product.findUnique({
      where: { id: cid },
      include: { variants: { orderBy: { position: "asc" } } },
    });
    if (!child) { console.error(`  ! child ${cid} missing`); continue; }

    const newTitle = `Vintage Solid Wood Jewellery Box — ${meta.label}`;
    const newHandle = slug(`vintage-solid-wood-jewellery-box-${meta.label}`);

    // rawPayload patch → accurate per-size landed cost
    let rawObj: Record<string, unknown> = {};
    try { rawObj = JSON.parse(child.rawPayload) as Record<string, unknown>; } catch {}
    const priceBlock = (rawObj.price ?? {}) as Record<string, unknown>;
    priceBlock.min = meta.cnyCost;
    priceBlock.max = meta.cnyCost;
    rawObj.price = priceBlock;
    rawObj.productWeightG = meta.weightG;
    const newRaw = JSON.stringify(rawObj);

    console.log(`\n${meta.label}  (${cid})  layers=${layers}`);
    console.log(`  title : ${newTitle}`);
    console.log(`  handle: ${newHandle}`);
    console.log(`  cost  : ¥${meta.cnyCost}  weight=${meta.weightG}g`);
    for (const v of child.variants) {
      const cleaned = cap(stripLayer(v.option1 ?? ""));
      console.log(`  variant: "${v.option1}"  ->  "${cleaned}"  (weight ${v.weight ?? "?"}g -> ${meta.weightG}g)`);
    }

    if (!APPLY) continue;

    await prisma.product.update({
      where: { id: cid },
      data: { title: newTitle, handle: newHandle, rawPayload: newRaw },
    });
    for (const v of child.variants) {
      const cleaned = cap(stripLayer(v.option1 ?? ""));
      await prisma.variant.update({
        where: { id: v.id },
        data: { option1: cleaned, title: cleaned, weight: meta.weightG, weightUnit: "g" },
      });
    }

    // Per-child hero override (general prompt). Parent id is gone; key by child.
    const ov = {
      productId: cid,
      productTitle: newTitle,
      authoredBy: "one-off: wooden jewellery box (not lighting) — general product-photography hero prompt. Split child of deleted parent cmpxvghau000hw260fnktskfz.",
      authoredAt: "2026-06-03",
      heroPromptOverride: generalHeroPrompt,
    };
    fs.writeFileSync(path.resolve(process.cwd(), `hero-overrides/${cid}.json`), JSON.stringify(ov, null, 2));
    console.log(`  ✓ patched + wrote hero-overrides/${cid}.json`);
  }

  if (!APPLY) console.log(`\n[dry-run] re-run with --apply to write.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
