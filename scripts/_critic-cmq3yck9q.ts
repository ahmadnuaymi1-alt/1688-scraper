/**
 * Hero critic pass for cmq3yck9q000jw2q03468fge7
 * Checks the watch hero against the category-watches.md rubric using Gemini Vision.
 */
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
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

const PID = "cmq3yck9q000jw2q03468fge7";
const MODEL = "gemini-2.5-flash";

const RUBRIC = `
You are critiquing a wristwatch HERO image generated for an e-commerce product catalog.

Check the image against these requirements:
1. NO paper price tag, hang tag, certificate card, paper label, QR code, barcode, sticker, or string attached to the watch.
2. NO cushion, pillow, watch roll, watch holder, display bust, fabric pad, velvet roll, or presentation box under or through the band.
3. NO transparent acrylic display stand, clear plastic watch holder, perspex prop, or invisible support of any kind under or behind the case.
4. Watch case stands UPRIGHT at a 3/4 angle (dial rotated 25-30 degrees off head-on, bracelet curving down to lower-right). NOT flat-lay, NOT top-down, NOT pure side profile.
5. Crystal reads fully transparent — dial face, hands, applied markers, brand text, model text, date numeral, and sub-dials are sharp and legible.
6. No people, hands, faces, or body parts visible.
7. No text overlays, watermarks, captions, brand logos rendered separately, signage.
8. Photorealistic — not cartoon, illustration, or stylized render.

Reply with ONLY strict minified JSON, no markdown:
{
  "verdict": "clean" | "minor" | "major",
  "flags": ["short list of any failures, e.g. 'plastic stand', 'paper tag', 'flat-lay angle'"],
  "comment": "one-sentence rationale"
}
verdict=clean means no issues. minor=cosmetic issue worth a regen. major=must regen.
`;

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.slice(0, 100)}`);
  const ct = res.headers.get("content-type") || "image/jpeg";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime, data: buf.toString("base64") };
}

async function classify(imageUrl: string): Promise<string> {
  const key = process.env.GEMINI_VISION_API_KEY;
  if (!key) throw new Error("GEMINI_VISION_API_KEY is not set");
  const img = await fetchImageAsBase64(imageUrl);
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: img.mime, data: img.data } }, { text: RUBRIC }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function main() {
  const prisma = new PrismaClient();
  const heroes = await prisma.productImage.findMany({
    where: { productId: PID, imageType: { in: ["hero", "hero-flat"] } },
    select: { id: true, storagePath: true, sourceUrl: true, variantId: true },
  });
  console.log(`${heroes.length} hero(es) found`);
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const bucket = process.env.SUPABASE_BUCKET ?? "product-images";
  for (const h of heroes) {
    const url = h.storagePath ? `${baseUrl}/storage/v1/object/public/${bucket}/${h.storagePath}` : h.sourceUrl ?? "";
    console.log(`\nHero ${h.id} variant=${h.variantId} url=${url}`);
    const txt = await classify(url);
    console.log("Verdict:", txt);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
