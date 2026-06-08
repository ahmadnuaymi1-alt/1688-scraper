/**
 * Gemini Vision check for the jewelry box variants + gallery.
 * Confirms Black / Nude Pink names match their featured images, and scans the
 * full gallery for any with/without-mirror or size axis that should split.
 * Read-only (no DB writes).
 */
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { PrismaClient } from "@prisma/client";

function loadEnvLocal(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const ID = "cmq48dfkz000jw2ik1ziakg6o";
const BUCKET = "product-images";

function publicUrl(storagePath: string): string {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function fetchB64(url: string): Promise<{ b64: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/jpeg";
  return { b64: buf.toString("base64"), mime };
}

async function askGemini(prompt: string, images: { b64: string; mime: string }[]): Promise<string> {
  const key = process.env.GEMINI_VISION_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no gemini key");
  const parts: any[] = [{ text: prompt }];
  for (const im of images) parts.push({ inline_data: { mime_type: im.mime, data: im.b64 } });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts }] }) }
  );
  const j: any = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "(no text)";
}

async function main() {
  const prisma = new PrismaClient();
  const r = await prisma.product.findUnique({ where: { id: ID }, include: { variants: { orderBy: { position: "asc" } }, images: { orderBy: { position: "asc" } } } });
  if (!r) { console.log("NOT FOUND"); await prisma.$disconnect(); return; }

  // Per-variant featured image color check
  for (const v of r.variants) {
    const fi = r.images.find((i) => i.id === v.featuredImageId);
    if (!fi) { console.log(`${v.option1}: NO featured image`); continue; }
    const sp = (fi as any).storagePath;
    const img = await fetchB64(publicUrl(sp));
    const ans = await askGemini(
      `This is the featured product image for a jewelry box variant currently named "${v.option1}". ` +
      `In 1-2 sentences: what is the dominant exterior color of the box? Does it have a visible mirror inside? ` +
      `Does the name "${v.option1}" accurately describe this box's color? Answer concisely.`,
      [img]
    );
    console.log(`\n=== VARIANT "${v.option1}" (featured ${sp.split("/").pop()}) ===\n${ans.trim()}`);
  }

  // Whole gallery scan for axis candidates (mirror present/absent, multiple sizes)
  const gallery: { b64: string; mime: string }[] = [];
  for (const im of r.images.slice(0, 7)) {
    const sp = (im as any).storagePath;
    try { gallery.push(await fetchB64(publicUrl(sp))); } catch (e) { console.log(`skip ${sp}: ${e}`); }
  }
  const scan = await askGemini(
    `These are all ${gallery.length} gallery images for one jewelry-box listing. Looking across ALL of them: ` +
    `(1) How many distinct EXTERIOR COLORS of the box appear? List them. ` +
    `(2) Do the images show MORE THAN ONE SIZE of box (e.g. a small and a large), or just one size? ` +
    `(3) Do ALL boxes have a built-in mirror, or do some lack a mirror (i.e. a with-mirror vs without-mirror distinction)? ` +
    `(4) Any printed measurement annotations (cm / mm / 长宽高)? Report the numbers you can read. ` +
    `Be concise and concrete.`,
    gallery
  );
  console.log(`\n=== GALLERY AXIS SCAN (${gallery.length} imgs) ===\n${scan.trim()}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
