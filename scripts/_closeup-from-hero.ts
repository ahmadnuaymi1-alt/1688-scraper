/**
 * Generate a macro CLOSE-UP from a product's clean HERO image (not the raw
 * source swatch). Use when the standard _hf-cli-bulk-closeups.ts keeps tripping
 * Higgsfield's nsfw filter on the raw supplier swatch — the hero is a clean
 * studio render and passes. Attaches as imageType="closeup", fileName
 * "front-detail.png" (idempotent: skips if a closeup already exists).
 *
 *   npx tsx scripts/_closeup-from-hero.ts <productId> [--apply]
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
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const TMP = path.join(os.tmpdir(), "scene", "closeup-hero");
fs.mkdirSync(TMP, { recursive: true });

const PROMPT =
  "Macro product photograph — tight close-up of the wooden jewellery box, three-quarter angle. Render the box so it looks VISUALLY IDENTICAL to the reference image — same wood tone, finish, grain, brass hardware, velvet-lined compartments and drawers. The box fills 80-90% of the frame, sharply revealing the open top tray's velvet compartment grid and a couple of the stacked drawers and brass pulls in crisp detail. Backdrop: pale greige (hex #ECE6DC) infinity cove, soft even neutral 5500K studio light, faint contact shadow, no visible plane edges. Photorealistic, macro lens, f/5.6, razor-sharp focus on the wood and velvet texture, true-to-life colour, no props, no text, no watermark, no people.";

function supa() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE creds not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

(async () => {
  if (!PID) { console.error("usage: _closeup-from-hero.ts <productId> [--apply]"); process.exit(1); }
  const existing = await prisma.productImage.findFirst({ where: { productId: PID, imageType: "closeup" }, select: { id: true } });
  if (existing) { console.log(`${PID} already has a closeup — skip`); await prisma.$disconnect(); return; }
  const hero = await prisma.productImage.findFirst({
    where: { productId: PID, imageType: "hero-flat", storagePath: { not: null } },
    select: { storagePath: true }, orderBy: { position: "asc" },
  });
  if (!hero?.storagePath) { console.error("no hero ref"); process.exit(1); }
  const product = await prisma.product.findUnique({ where: { id: PID }, select: { title: true } });
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const heroUrl = `${base}/storage/v1/object/public/${BUCKET}/${hero.storagePath}`;
  const storagePath = `closeups/${PID}/front-detail.png`;
  console.log(`Closeup-from-hero ${PID}\n  ref=${hero.storagePath}`);
  if (!APPLY) { console.log("[dry-run] --apply"); await prisma.$disconnect(); return; }

  const heroLocal = path.join(TMP, `${PID}__ref.png`);
  const r = await fetch(heroUrl);
  fs.writeFileSync(heroLocal, Buffer.from(await r.arrayBuffer()));
  const uploadId = await higgsfieldUpload(heroLocal);
  const t0 = Date.now();
  const { imageBuffer } = await higgsfieldGenerate({
    prompt: PROMPT.replace(/\s+/g, " ").trim(),
    inputUploadIds: [uploadId], aspectRatio: "1:1", resolution: "1k",
  });
  const { error } = await supa().storage.from(BUCKET).upload(storagePath, imageBuffer, { contentType: "image/png", upsert: true });
  if (error) { console.error(`upload fail: ${error.message}`); process.exit(1); }
  const maxPos = await prisma.productImage.aggregate({ where: { productId: PID }, _max: { position: true } });
  await prisma.productImage.create({
    data: {
      productId: PID, variantId: null, sourceUrl: `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`,
      storagePath, fileName: "front-detail.png", altText: `Close-up — ${product?.title?.slice(0, 80) ?? ""}`,
      position: (maxPos._max.position ?? 0) + 1, downloadStatus: "downloaded", imageType: "closeup",
    },
  });
  console.log(`✓ closeup attached (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
