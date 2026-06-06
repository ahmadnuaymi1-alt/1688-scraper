/**
 * Make each jewellery-box child SIZE-SPECIFIC before re-running the rules.
 * The children inherited the parent's rawPayload (whose 颜色 attribute lists ALL
 * 32 original variants incl. mirror/10-layer/scent) + a generic productContext,
 * so the description/title rules over-generalised (e.g. mentioned "mirror" on the
 * 4-layer). For each child we:
 *   - derive the real features present from THIS child's variant labels
 *   - set a clean, size-specific productContext that says "describe ONLY this size"
 *   - rewrite rawPayload.title + 颜色 + 规格 to this size only
 *
 * Sequential writes. --apply to write.
 *   npx tsx scripts/_clean-child-context.ts [--apply]
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

(async () => {
  for (const [cid, layers] of Object.entries(CHILDREN)) {
    const child = await prisma.product.findUnique({
      where: { id: cid },
      include: { variants: { orderBy: { position: "asc" } } },
    });
    if (!child) { console.error(`! ${cid} missing`); continue; }

    const labels = child.variants.map((v) => v.option1 ?? "").filter(Boolean);
    const blob = labels.join(" | ").toLowerCase();
    const hasMirror = blob.includes("mirror");
    const hasLock = blob.includes("lock");
    const hasHooks = blob.includes("hook");
    const isLarge = layers >= 7;

    const feats: string[] = [`${layers} stacked tiers/drawers`, "soft velvet lining"];
    if (hasLock) feats.push("full lock with copper key");
    if (hasMirror) feats.push("built-in mirror");
    if (hasHooks) feats.push("necklace hooks");
    if (isLarge) feats.push("extra-large storage capacity");

    const titleCore =
      layers === 6 ? "6-Layer Mirrored" : isLarge ? `${layers}-Layer Large-Capacity` : `${layers}-Layer`;
    const sourceTitle = `Vintage Solid Wood ${titleCore} Jewelry Box`;

    const context =
      `This is the ${layers}-LAYER (${layers}-tier) model of a vintage solid-wood jewelry box, sold as its own product (one size out of a family that was split by tier count). ` +
      `Material: solid wood with a wood-grain, water-based painted finish; brass-tone hardware. ` +
      `Features present in THIS size: ${feats.join(", ")}. ` +
      `Available finishes/configurations (these are the variants — describe the range, do not invent others): ${labels.join("; ")}. ` +
      `STRICT: describe ONLY the ${layers}-layer size and ONLY the features listed above. ` +
      `Do NOT mention other tier counts, and do NOT mention ${hasMirror ? "" : "a mirror, "}${hasHooks ? "" : "hooks, "}${hasLock ? "" : "a lock, "}` +
      `scented sachets, or any feature not in this size. Always state the tier count (${layers}-tier) prominently.`;

    // rawPayload patch: 颜色 -> this size's variants; title -> size-specific; add 规格.
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(child.rawPayload) as Record<string, unknown>; } catch {}
    raw.title = sourceTitle;
    type Attr = { name?: string; value?: string };
    const attrs: Attr[] = Array.isArray(raw.featureAttributes) ? (raw.featureAttributes as Attr[]) : [];
    const colorAttr = attrs.find((a) => a?.name === "颜色");
    if (colorAttr) colorAttr.value = labels.join(",");
    let specAttr = attrs.find((a) => a?.name === "规格");
    if (specAttr) specAttr.value = `${layers}层 / ${layers}-tier`;
    else attrs.push({ name: "规格", value: `${layers}层 / ${layers}-tier` });
    raw.featureAttributes = attrs;

    console.log(`\n${layers}-Layer (${cid})`);
    console.log(`  sourceTitle: ${sourceTitle}`);
    console.log(`  feats: ${feats.join(", ")}`);
    console.log(`  mirror=${hasMirror} lock=${hasLock} hooks=${hasHooks}`);

    if (!APPLY) continue;
    await prisma.product.update({
      where: { id: cid },
      data: { productContext: context, rawPayload: JSON.stringify(raw) },
    });
    console.log(`  ✓ written`);
  }
  if (!APPLY) console.log(`\n[dry-run] --apply to write`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
