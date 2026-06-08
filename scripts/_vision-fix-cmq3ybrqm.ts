/**
 * agent-mode Step 3 for cmq3ybrqm000jw25g2h0dyzbp.
 *
 * - Run Gemini Vision on variants whose option1 is opaque ("Style 1".."Style 4")
 *   and propose customer-friendly names (case / dial / strap attributes).
 * - Also run it on ALL variants briefly to check duplicates / packaging-only false positives.
 * - Apply renames (do-no-harm: only overwrite opaque names).
 * - Set Product.productType = "watch".
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";
const MODEL = "gemini-2.5-flash";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";

const PROMPT = `You are analyzing a wristwatch product variant image from a 1688 supplier listing. Look at the watch in the image and identify the visible attributes you can use to give the variant a customer-friendly name.

If the image shows something that is NOT a wearable watch (e.g. a presentation box only, a gift bag, a packaging upsell, a tool kit), say so via "isWatch": false.

Reply with ONLY strict minified JSON, no markdown:
{
  "isWatch": true/false,
  "caseColor": "Silver|Gold|Rose Gold|Two-Tone Gold and Silver|Black|...",
  "dialColor": "Black|White|Blue|Green|Cream|...",
  "strapColor": "Stainless Steel Silver|Stainless Steel Gold|Stainless Steel Two-Tone|Black Leather|Brown Leather|...",
  "bezelColor": "Black|Blue|Green|None|...",
  "distinguishing": "short phrase (e.g. 'skeleton dial', 'chronograph', 'date at 3', 'arabic numerals 12/6')",
  "proposedName": "concise customer-friendly variant name combining the most distinctive attributes (e.g. 'Silver Case / Blue Dial / Steel Bracelet')"
}`;

interface Verdict {
  isWatch: boolean;
  caseColor: string;
  dialColor: string;
  strapColor: string;
  bezelColor: string;
  distinguishing: string;
  proposedName: string;
  raw: string;
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
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
      const p = JSON.parse(jsonStr);
      return {
        isWatch: p.isWatch !== false,
        caseColor: String(p.caseColor ?? ""),
        dialColor: String(p.dialColor ?? ""),
        strapColor: String(p.strapColor ?? ""),
        bezelColor: String(p.bezelColor ?? ""),
        distinguishing: String(p.distinguishing ?? ""),
        proposedName: String(p.proposedName ?? ""),
        raw: text,
      };
    } catch (e) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
      else throw e;
    }
  }
  throw new Error("unreachable");
}

async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

function isOpaque(name: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  if (/^style\s+\d+$/i.test(n)) return true;
  if (/^design\s+[a-z0-9]+$/i.test(n)) return true;
  if (/^[a-z]?\s*\d+$/i.test(n)) return true;
  if (/^new\s+style\s+\d+$/i.test(n)) return true;
  return false;
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

    console.log(`\nClassifying ALL ${inputs.length} variant images via Gemini (concurrency 4)...`);
    const results = await withConcurrency(inputs, 4, async ({ v, imgUrl }, idx) => {
      if (!imgUrl) return { v, verdict: null, error: "no image url" };
      try {
        const verdict = await classify(imgUrl);
        const tag = verdict.isWatch ? "" : " [NOT WATCH]";
        console.log(`  [${idx + 1}/${inputs.length}] #${v.position} (opaque=${isOpaque(v.option1 ?? "") ? "Y" : "N"}): ${verdict.proposedName}${tag}`);
        return { v, verdict, error: null as string | null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  [${idx + 1}/${inputs.length}] #${v.position}: ERROR ${msg}`);
        return { v, verdict: null, error: msg };
      }
    });

    console.log("\n========== APPLYING RENAMES (opaque only) ==========");
    let renamed = 0;
    let hidNonWatch = 0;
    for (const r of results) {
      if (!r.verdict) continue;
      const curName = r.v.option1 ?? "";
      // Hide non-watch variants (packaging upsells)
      if (!r.verdict.isWatch) {
        await p.variant.update({ where: { id: r.v.id }, data: { isHidden: true } });
        console.log(`  HIDE #${r.v.position} (not a watch) — was "${curName}"`);
        hidNonWatch++;
        continue;
      }
      if (isOpaque(curName) && r.verdict.proposedName) {
        await p.variant.update({
          where: { id: r.v.id },
          data: { option1: r.verdict.proposedName, title: r.verdict.proposedName },
        });
        console.log(`  RENAME #${r.v.position}: "${curName}" → "${r.verdict.proposedName}"`);
        renamed++;
      }
    }

    // Set productType = "watch"
    await p.product.update({ where: { id: PID }, data: { productType: "watch" } });
    console.log(`\nSET productType = "watch"`);

    console.log(`\nDone — renamed ${renamed} variants, hid ${hidNonWatch} non-watch variants`);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
