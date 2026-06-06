/**
 * Regenerate the open-drawer lifestyle for a TALL-TOWER jewellery box (7/10-layer)
 * with tower-explicit language, because the generic "lid open" scene-7 prompt
 * drifted the tower into a small lift-lid box. Upserts the SAME storagePath so
 * the existing ProductImage row just points at the corrected blob.
 *
 *   npx tsx scripts/_regen-tower-lifestyle.ts <productId> [--apply]
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

const PID = process.argv[2];
const APPLY = process.argv.includes("--apply");
const SLUG = "v1_lifestyle_7_open-drawer-detail";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const TMP = path.join(os.tmpdir(), "scene", "regen");
fs.mkdirSync(TMP, { recursive: true });

const PROMPT =
  "Editorial interior photograph on a 50mm lens, square 1:1, at a low three-quarter tabletop angle. The TALL multi-drawer wooden jewellery TOWER stands on a warm oak dresser with its hinged side door swung open (revealing necklace hooks inside the door) and TWO of its stacked drawers pulled out at staggered depths; the velvet-lined top tray and the open drawers are freshly styled with a DIFFERENT arrangement of fine jewellery — slim gold rings in the compartment grid, pearl stud earrings, a coiled gold chain, and a slim wristwatch resting in one open drawer. Soft window light from frame-right. Secondary styling, minimal: a small ceramic ring dish, a folded oatmeal-linen runner with natural creases, a short sprig of eucalyptus. Imperfections: one earring sits slightly askew and the linen is gently rumpled. Palette: warm walnut, taupe velvet, oatmeal linen, gold, sage. Render the TALL multi-tier jewellery TOWER EXACTLY as shown in the reference image — preserve its FULL HEIGHT, every stacked drawer, the hinged side door, wood tone, finish and brass hardware. Show the side door open and two drawers pulled out, varying ONLY the jewellery arranged inside. Do NOT shorten or simplify it into a small lift-lid box. Photorealistic editorial interior photograph, natural daylight, sharp focus, no people, no text, no watermark, no alcohol.";

function supa() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE creds not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

(async () => {
  if (!PID) { console.error("usage: _regen-tower-lifestyle.ts <productId> [--apply]"); process.exit(1); }
  const row = await prisma.productImage.findFirst({
    where: { productId: PID, fileName: `${SLUG}.png`, imageType: "lifestyle" },
    select: { id: true, storagePath: true },
  });
  if (!row?.storagePath) { console.error(`no existing ${SLUG} row for ${PID}`); process.exit(1); }
  const hero = await prisma.productImage.findFirst({
    where: { productId: PID, imageType: "hero-flat", storagePath: { not: null } },
    select: { storagePath: true },
    orderBy: { position: "asc" },
  });
  if (!hero?.storagePath) { console.error("no hero ref"); process.exit(1); }
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const heroUrl = `${base}/storage/v1/object/public/${BUCKET}/${hero.storagePath}`;
  console.log(`Regen ${SLUG} for ${PID}\n  ref=${hero.storagePath}\n  target=${row.storagePath}`);
  if (!APPLY) { console.log("[dry-run] --apply to regenerate"); await prisma.$disconnect(); return; }

  const heroLocal = path.join(TMP, `${PID}__ref.png`);
  const r = await fetch(heroUrl);
  fs.writeFileSync(heroLocal, Buffer.from(await r.arrayBuffer()));
  const uploadId = await higgsfieldUpload(heroLocal);
  const t0 = Date.now();
  const { imageBuffer } = await higgsfieldGenerate({
    prompt: PROMPT.replace(/\s+/g, " ").trim(),
    inputUploadIds: [uploadId],
    aspectRatio: "1:1",
    resolution: "1k",
  });
  const { error } = await supa().storage.from(BUCKET).upload(row.storagePath, imageBuffer, { contentType: "image/png", upsert: true });
  if (error) { console.error(`upload fail: ${error.message}`); process.exit(1); }
  console.log(`✓ regenerated + overwrote (${((Date.now() - t0) / 1000).toFixed(0)}s) — same DB row, corrected blob`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
