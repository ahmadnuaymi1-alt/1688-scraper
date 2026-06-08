import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
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
const PID = process.argv[2] ?? "cmq49ytdh000jw28g3kax9zpo";
const KEY = process.env.GEMINI_VISION_API_KEY || process.env.GEMINI_API_KEY!;
const PROMPT = `This is a studio hero photo of a men's wristwatch. Answer ONLY with JSON: {"box": "yes"|"no" (is ANY presentation box, gift box, watch case, packaging, or display stand visible in the frame?), "band": "metal"|"rubber"|"leather"|"fabric"|"other" (what is the watch band/strap material?), "notes": "<one short phrase>"}`;

async function check(b64: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: "image/png", data: b64 } }] }] }),
  });
  const j: any = await res.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(j).slice(0, 200);
}

async function main() {
  const prisma = new PrismaClient();
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
  const heroes = await prisma.productImage.findMany({ where: { productId: PID, imageType: "hero-flat" }, orderBy: { position: "asc" }, select: { id: true, storagePath: true, variantId: true } });
  const variants = await prisma.variant.findMany({ where: { productId: PID }, select: { id: true, option1: true } });
  for (const h of heroes) {
    const url = supabase.storage.from(bucket).getPublicUrl(h.storagePath!).data.publicUrl;
    const r = await fetch(url);
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    const label = variants.find((v) => v.id === h.variantId)?.option1 ?? h.id;
    const verdict = await check(b64);
    console.log(`${label}: ${verdict.replace(/\s+/g, " ").trim()}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
