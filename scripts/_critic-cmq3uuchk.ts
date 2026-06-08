/**
 * Phase 0d critic — score the 4 freshly-generated heroes on cmq3uuchk against
 * category-watches.md rubric (including the new plastic-stand rule).
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

const PID = "cmq3uuchk000jw2ckrijd98hq";
const MODEL = "gemini-2.5-flash";

const RUBRIC = `You are doing watch product-hero QA against the category-watches.md rubric. Reply ONLY in strict minified JSON.

For each rule below, mark PASS or FAIL based on what you see in the image. If FAIL, briefly say what's visible.

Rules:
A) NO_TAG: no paper price tag, hang tag, certificate card, paper label, QR code, barcode, sticker, dangling string, rectangular white paper, or supplier watermark anywhere in frame
B) NO_PROP: no cushion, pillow, watch roll, watch holder, display bust, fabric pad, velvet roll, presentation box, or any clear acrylic/plastic display stand/holder/prop/riser/plinth under or near the watch
C) UPRIGHT: watch case stands UPRIGHT at a 3/4 angle (dial rotated 25-30° off head-on, bracelet curving down). NOT flat-lay, NOT top-down, NOT pure side profile, NOT lying on caseback
D) LEGIBLE: crystal is glare-free and the dial face (including any visible skeleton/openwork pattern), hands, applied markers, brand text, and subdials are sharp and clearly legible
E) NO_PEOPLE: no people, no hands, no body parts in frame
F) NO_TEXT: no rendered text overlay, no watermark, no caption, no brand logo signage drawn on or near the image (the dial's own brand text is OK)
G) SCALE: case occupies roughly 40% of frame width, watch+bracelet ~70%, centered slightly above midpoint

Return:
{"A":"pass|fail","A_detail":"","B":"pass|fail","B_detail":"","C":"pass|fail","C_detail":"","D":"pass|fail","D_detail":"","E":"pass|fail","E_detail":"","F":"pass|fail","F_detail":"","G":"pass|fail","G_detail":"","overall":"clean|minor|major"}`;

interface R { A:string;A_detail:string;B:string;B_detail:string;C:string;C_detail:string;D:string;D_detail:string;E:string;E_detail:string;F:string;F_detail:string;G:string;G_detail:string;overall:string; }

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
  const res = await fetch(url);
  const ct = res.headers.get("content-type") || "image/png";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime, data: buf.toString("base64") };
}

async function classify(imageUrl: string): Promise<R> {
  const key = process.env.GEMINI_VISION_API_KEY!;
  const img = await fetchImageAsBase64(imageUrl);
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: img.mime, data: img.data } }, { text: RUBRIC }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBrace = cleaned.indexOf("{"); const lastBrace = cleaned.lastIndexOf("}");
  return JSON.parse(firstBrace >= 0 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned) as R;
}

(async () => {
  const p = new PrismaClient();
  const heroes = await p.productImage.findMany({
    where: { productId: PID, imageType: { in: ["hero", "hero-flat"] } },
    select: { id: true, sourceUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const variants = await p.variant.findMany({
    where: { productId: PID, featuredImageId: { in: heroes.map((h) => h.id) } },
    select: { title: true, position: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  const variantByHero = new Map<string, typeof variants[number]>();
  for (const v of variants) if (v.featuredImageId) variantByHero.set(v.featuredImageId, v);

  console.log(`Critiquing ${heroes.length} heroes...`);
  for (const h of heroes) {
    try {
      const r = await classify(h.sourceUrl ?? "");
      const v = variantByHero.get(h.id);
      const fails: string[] = [];
      for (const key of ["A","B","C","D","E","F","G"] as const) {
        if (r[key] === "fail") fails.push(`${key}=${(r as any)[`${key}_detail`]}`);
      }
      console.log(`  #${v?.position ?? "?"} ${v?.title ?? "—"}: ${r.overall}${fails.length ? "  FAILS: "+fails.join(" ; ") : ""}`);
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await p.$disconnect();
})();
