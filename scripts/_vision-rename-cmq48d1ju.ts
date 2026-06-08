/**
 * Agent-mode Step 1: Gemini Vision over the 6 variant featured images for
 * cmq48d1ju000jw2gowuwbmolt (Stainless Steel Round Quartz Dual Calendar Watch).
 * Read-only — prints proposed attribute names + dup detection. Does NOT mutate DB.
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

const PID = "cmq48d1ju000jw2gowuwbmolt";
const MODEL = "gemini-2.5-flash";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";

const PROMPT = `You are analyzing a men's wristwatch product variant image from a 1688 supplier listing. Look at the watch and identify the visible attributes.

Identify (if visible):
- case color/finish (silver/steel, gold, rose gold, two-tone, black, etc.)
- dial color AND dial pattern (e.g. "black", "blue", "starry sky / galaxy textured", "white", "silver/mirror")
- band/strap type AND color (e.g. "steel mesh / milanese band", "solid steel link bracelet", "leather", etc.)
- bezel (if distinctive)
- any distinguishing feature (date window, dual calendar windows, etc.)

Reply with ONLY strict minified JSON, no markdown:
{
  "caseColor": "Silver|Gold|Two-Tone|Black|...",
  "dialColor": "Black|Blue|Starry Sky|White|Silver|...",
  "dialPattern": "plain|starry-sky/galaxy|sunburst|...",
  "bandType": "Steel Mesh Band|Steel Link Bracelet|Leather|...",
  "distinguishing": "short phrase or empty",
  "proposedName": "concise customer-friendly variant name (e.g. 'Starry Sky Dial / Mesh Band' or 'Black Dial / Steel Bracelet')"
}`;

interface Verdict {
  caseColor: string; dialColor: string; dialPattern: string; bandType: string;
  distinguishing: string; proposedName: string; raw: string;
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url.slice(0, 100)}`);
  const ct = res.headers.get("content-type") || "image/png";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime, data: buf.toString("base64") };
}

async function classify(imageUrl: string): Promise<Verdict> {
  const key = process.env.GEMINI_VISION_API_KEY;
  if (!key) throw new Error("GEMINI_VISION_API_KEY is not set");
  const img = await fetchImageAsBase64(imageUrl);
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: img.mime, data: img.data } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
      if (!text) throw new Error("empty");
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const fb = cleaned.indexOf("{"); const lb = cleaned.lastIndexOf("}");
      const jsonStr = fb >= 0 && lb > fb ? cleaned.slice(fb, lb + 1) : cleaned;
      const p = JSON.parse(jsonStr);
      return {
        caseColor: String(p.caseColor ?? ""), dialColor: String(p.dialColor ?? ""),
        dialPattern: String(p.dialPattern ?? ""), bandType: String(p.bandType ?? ""),
        distinguishing: String(p.distinguishing ?? ""), proposedName: String(p.proposedName ?? ""), raw: text,
      };
    } catch (e) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
      else throw e;
    }
  }
  throw new Error("unreachable");
}

(async () => {
  const p = new PrismaClient();
  try {
    if (!process.env.GEMINI_VISION_API_KEY) throw new Error("GEMINI_VISION_API_KEY missing");
    const variants = await p.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: {
        id: true, position: true, title: true, option1: true, isHidden: true,
        featuredImage: { select: { id: true, sourceUrl: true, storagePath: true } },
      },
    });
    console.log(`Found ${variants.length} variants`);
    const inputs = variants.map((v) => {
      let imgUrl = v.featuredImage?.sourceUrl ?? "";
      if (v.featuredImage?.storagePath && SUPABASE_URL) {
        imgUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${v.featuredImage.storagePath}`;
      }
      return { v, imgUrl };
    });
    const results: Array<{ v: typeof variants[number]; verdict: Verdict | null; error: string | null }> = [];
    for (const { v, imgUrl } of inputs) {
      if (!imgUrl) { results.push({ v, verdict: null, error: "no image url" }); continue; }
      try {
        const verdict = await classify(imgUrl);
        console.log(`  #${v.position}: ${verdict.proposedName}`);
        results.push({ v, verdict, error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  #${v.position}: ERROR ${msg}`);
        results.push({ v, verdict: null, error: msg });
      }
    }
    console.log("\n========== PROPOSED ==========");
    const seen = new Map<string, number>();
    for (const r of results) {
      if (!r.verdict) { console.log(`#${r.v.position}  ERROR ${r.error}`); continue; }
      const key = `${r.verdict.dialColor}|${r.verdict.dialPattern}|${r.verdict.bandType}|${r.verdict.caseColor}`.toLowerCase();
      const firstPos = seen.get(key);
      if (firstPos === undefined) seen.set(key, r.v.position);
      console.log(
        `#${r.v.position}  orig="${r.v.option1}"\n     case=${r.verdict.caseColor}  dial=${r.verdict.dialColor}  pattern=${r.verdict.dialPattern}  band=${r.verdict.bandType}\n     -> ${r.verdict.proposedName}${firstPos !== undefined ? `   [DUP of #${firstPos}]` : ""}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
