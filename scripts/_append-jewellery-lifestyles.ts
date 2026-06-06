/**
 * Append 2 NEW functional-state lifestyle images to each jewellery-box child,
 * WITHOUT regenerating the existing 5:
 *   6) closed-gift-box  — the box shown fully CLOSED on a styled vanity
 *   7) open-drawer-detail — lid open + one drawer pulled out, fresh jewellery
 * Both are reference-anchored to the box's hero. Attaches as imageType="lifestyle"
 * with slugs v1_lifestyle_6/7 (non-colliding). Idempotent: skips a slug already
 * present. Sequential (Higgsfield CLI). 1k resolution.
 *
 *   npx tsx scripts/_append-jewellery-lifestyles.ts [--apply] [--only <cid>]
 */
import fs from "node:fs";
import os from "node:os";
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
import { createClient } from "@supabase/supabase-js";
import { higgsfieldUpload, higgsfieldGenerate } from "./_higgsfield-cli";

const APPLY = process.argv.includes("--apply");
const onlyArg = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? process.argv[i + 1] : null; })();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const TMP = path.join(os.tmpdir(), "scene", "append");
fs.mkdirSync(TMP, { recursive: true });

const CHILDREN = [
  "cmpxx12260001w2yspsqfr94i", "cmpxx130y000hw2ys0d5ikvsb", "cmpxx161q001pw2ysta9lvk0k",
  "cmpxx1854002lw2ys7vdeln6v", "cmpxx19xo003dw2ysoykzsyhg", "cmpxx1auc003tw2ysfupa6ih9",
];

const ANCHOR =
  "Render the wooden box EXACTLY as shown in the reference image — preserve its precise proportions, wood tone, finish, tier/drawer construction and every brass detail. Do not recolour, resize or restyle it. Photorealistic editorial interior photograph, natural daylight, sharp focus, no people, no text, no watermark, no alcohol.";

const NEW_SCENES = [
  {
    slug: "v1_lifestyle_6_closed-gift-box",
    heroIdx: 0,
    prompt:
      "Editorial interior photograph on a 50mm lens, square 1:1, at tabletop eye-level. The wooden box sits FULLY CLOSED — lid down and every drawer shut — on a honed white-marble vanity top, a round wall mirror softly out of focus behind it catching gentle morning window light. Secondary styling, kept low and minimal: a small stoneware dish holding a folded linen napkin, a single dried garden rose in a slim bud vase, a folded pair of reading glasses. Soft diffused light from frame-left. Imperfections: a faint dust bloom along the marble's front edge and one fallen rose petal beside the box. Palette: warm walnut, white marble, dusty rose, natural linen, soft brass. The box is presented CLOSED, with the lid down and drawers in. " +
      ANCHOR,
  },
  {
    slug: "v1_lifestyle_7_open-drawer-detail",
    heroIdx: 1,
    prompt:
      "Editorial interior photograph on a 50mm lens, square 1:1, at a low three-quarter tabletop angle. The wooden box rests on a warm oak dresser with its lid OPEN and ONE lower drawer pulled out, revealing velvet-lined compartments freshly styled with a DIFFERENT arrangement of fine jewellery — a few slim gold rings nested in the top-tray grid, a pair of pearl stud earrings, a fine gold chain coiled in one section, and a slim wristwatch resting in the open drawer. Soft window light from frame-right. Secondary styling, minimal: a small ceramic ring dish, a folded oatmeal-linen runner with natural creases, a short sprig of eucalyptus. Imperfections: one earring sits slightly askew and the linen is gently rumpled. Palette: warm walnut, taupe velvet, oatmeal linen, gold, sage. Show the lid open and one drawer pulled out, varying ONLY the jewellery arranged inside. " +
      ANCHOR,
  },
];

function supa() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE creds not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function publicUrl(storagePath: string): string {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}
async function download(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

(async () => {
  for (const cid of CHILDREN) {
    if (onlyArg && cid !== onlyArg) continue;
    const product = await prisma.product.findUnique({
      where: { id: cid },
      select: { title: true, images: true },
    });
    if (!product) { console.error(`! ${cid} missing`); continue; }
    const heroes = product.images
      .filter((i) => i.imageType === "hero-flat" && i.storagePath)
      .map((i) => publicUrl(i.storagePath!));
    if (heroes.length === 0) { console.error(`! ${cid} no heroes`); continue; }
    const existing = new Set(product.images.map((i) => i.fileName));
    const sizeLabel = product.title.split("—").pop()?.trim() ?? cid;
    console.log(`\n${sizeLabel} (${cid})  heroes=${heroes.length}`);

    let nextPos = Math.max(0, ...product.images.map((i) => i.position)) + 1;
    for (const scene of NEW_SCENES) {
      const fileName = `${scene.slug}.png`;
      if (existing.has(fileName)) { console.log(`  = ${scene.slug} already present — skip`); continue; }
      const heroUrl = heroes[Math.min(scene.heroIdx, heroes.length - 1)];
      console.log(`  → ${scene.slug}  ref=${heroUrl.split("/").pop()}`);
      if (!APPLY) continue;
      const heroLocal = path.join(TMP, `${cid}__${scene.slug}__ref.png`);
      await download(heroUrl, heroLocal);
      const uploadId = await higgsfieldUpload(heroLocal);
      const t0 = Date.now();
      const { imageBuffer } = await higgsfieldGenerate({
        prompt: scene.prompt.replace(/\s+/g, " ").trim(),
        inputUploadIds: [uploadId],
        aspectRatio: "1:1",
        resolution: "1k",
      });
      const storagePath = `lifestyle/${cid}/${scene.slug}.png`;
      const { error } = await supa().storage.from(BUCKET).upload(storagePath, imageBuffer, { contentType: "image/png", upsert: true });
      if (error) { console.error(`  ✗ upload ${scene.slug}: ${error.message}`); continue; }
      await prisma.productImage.create({
        data: {
          productId: cid, variantId: null, sourceUrl: publicUrl(storagePath), storagePath,
          fileName, altText: `Lifestyle scene — ${product.title.slice(0, 80)}`,
          position: nextPos++, downloadStatus: "downloaded", imageType: "lifestyle",
        },
      });
      console.log(`  ✓ ${scene.slug} (${((Date.now() - t0) / 1000).toFixed(0)}s) → attached`);
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
