/**
 * Quick vision pass on the single variant of cmq3yck9q000jw2q03468fge7
 * to derive a customer-friendly variant name from the image.
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

const PROMPT = `You are analyzing a wristwatch product image. Identify:
- case color/finish (silver, gold, rose gold, two-tone, black, etc.)
- dial color (white, cream, black, blue, green, etc.)
- dial style (Roman numerals, Arabic numerals, baton markers, subdial position, etc.)
- strap color/material (black leather, brown leather, tan leather, etc.)
- bezel color/style (if distinctive)
- distinguishing feature (date window, sub-dial, chronograph, etc.)

Reply with ONLY strict minified JSON, no markdown:
{
  "caseColor": "...",
  "dialColor": "...",
  "strapColor": "...",
  "bezelColor": "...",
  "distinguishing": "...",
  "proposedName": "concise customer-friendly variant name combining the most distinctive attributes (e.g. 'Silver / Cream Dial / Brown Leather')"
}`;

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.slice(0, 100)}`);
  const ct = res.headers.get("content-type") || "image/jpeg";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime, data: buf.toString("base64") };
}

async function classify(imageUrl: string) {
  const key = process.env.GEMINI_VISION_API_KEY;
  if (!key) throw new Error("GEMINI_VISION_API_KEY is not set");
  const img = await fetchImageAsBase64(imageUrl);
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: img.mime, data: img.data } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

async function main() {
  const prisma = new PrismaClient();
  const variant = await prisma.variant.findFirst({
    where: { productId: PID },
    include: { featuredImage: { select: { storagePath: true, sourceUrl: true } } },
  });
  if (!variant) {
    console.log("No variant found");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const bucket = process.env.SUPABASE_BUCKET ?? "product-images";
  const imageUrl =
    variant.featuredImage?.storagePath
      ? `${url}/storage/v1/object/public/${bucket}/${variant.featuredImage.storagePath}`
      : variant.featuredImage?.sourceUrl ?? "";
  console.log(`Variant #${variant.position}  current name = ${JSON.stringify(variant.option1)}`);
  console.log(`Image URL: ${imageUrl}`);
  const txt = await classify(imageUrl);
  console.log("\nGEMINI VERDICT:\n", txt);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
