/**
 * Add ONE macro closeup for a product whose 1688 originals were already deleted,
 * by using a hero-flat image as the Higgsfield reference (instead of a now-gone
 * source). Idempotent: skips if the product already has a closeup row.
 *   npx tsx scripts/_speedtest-closeup-from-hero.ts <productId>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { higgsfieldUpload, higgsfieldGenerate } from "./_higgsfield-cli";
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

const PID = process.argv[2];
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const PROMPT =
  `Ultra-macro product close-up. Render the product VISUALLY IDENTICAL to the reference image — every surface, finish, colour, material, applied detail, printed marker and grain must match exactly. ` +
  `EXTREME TIGHT CROP: the product fills 90-98% of the frame in both width and height (edges may crop). Frame the single most distinctive surface (a watch dial face with applied markers/hands/date; a box's velvet tray or hardware; a pendant's face) straight-on so texture and applied details are razor-sharp and readable. No wide framing, no negative space. ` +
  `Camera: front-on, square to the product face. Square 1:1. Macro 100mm f/5.6 — razor sharp, immediate backdrop softly out of focus. ` +
  `Backdrop: flat pale greige (#ECE6DC) infinity cove, continuous, no horizon/plane transitions. Soft contact shadow only. ` +
  `Lighting: neutral 5500K studio strobes raking across the surface to reveal texture. ` +
  `Preserve product-native text (a watch dial's brand/model/date) legibly and identically; otherwise REMOVE every reference-image text overlay, dimension callout, Chinese character, supplier logo/watermark/sticker. ` +
  `Photorealistic, sharp focus, no props, no people, no hands, no watch cushion/roll/holder, no plastic stand. ` +
  `Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle.`;

async function main() {
  if (!PID) throw new Error("usage: _speedtest-closeup-from-hero.ts <productId>");
  const prisma = new PrismaClient();
  const existing = await prisma.productImage.count({ where: { productId: PID, imageType: "closeup" } });
  if (existing > 0) { console.log(`already has ${existing} closeup(s) — skip`); await prisma.$disconnect(); return; }

  const hero = await prisma.productImage.findFirst({
    where: { productId: PID, imageType: { in: ["hero-flat", "hero"] }, storagePath: { not: null } },
    orderBy: { position: "asc" },
    select: { storagePath: true },
  });
  if (!hero?.storagePath) { console.log("no hero image to use as reference"); await prisma.$disconnect(); return; }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const refUrl = supabase.storage.from(BUCKET).getPublicUrl(hero.storagePath).data.publicUrl;
  const tmpDir = path.join(os.tmpdir(), "closeup-from-hero");
  fs.mkdirSync(tmpDir, { recursive: true });
  const refLocal = path.join(tmpDir, `${PID}.png`);
  const dl = await fetch(refUrl);
  if (!dl.ok) throw new Error(`download hero ${dl.status}`);
  fs.writeFileSync(refLocal, Buffer.from(await dl.arrayBuffer()));

  const template = path.join(os.tmpdir(), "scene", "v25-refs", "positioning-template.png");
  if (!fs.existsSync(template)) throw new Error(`positioning template missing at ${template}`);

  const [refId, tmplId] = await Promise.all([higgsfieldUpload(refLocal), higgsfieldUpload(template)]);
  const { imageBuffer } = await higgsfieldGenerate({ prompt: PROMPT, inputUploadIds: [refId, tmplId] });

  const storagePath = `closeups/${PID}/front-detail.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, imageBuffer, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`supabase upload: ${error.message}`);
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const maxPos = await prisma.productImage.aggregate({ where: { productId: PID }, _max: { position: true } });
  await prisma.productImage.create({
    data: { productId: PID, variantId: null, sourceUrl: publicUrl, storagePath, fileName: "front-detail.png", position: (maxPos._max.position ?? 0) + 1, downloadStatus: "downloaded", imageType: "closeup" },
  });
  console.log(`closeup created for ${PID}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
