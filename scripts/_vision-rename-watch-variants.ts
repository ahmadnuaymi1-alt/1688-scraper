/**
 * Phase-0b dogfood step: Use Gemini Vision to look at the 23 variant images for
 * cmq3nwk6g000jw2hst5cwxfj8 (Stainless Steel Round Quartz Chronograph Watch)
 * and derive customer-friendly names. Read-only — prints the proposed rename
 * mapping; does NOT mutate the DB. Apply separately after review.
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

const PID = "cmq3nwk6g000jw2hst5cwxfj8";
const MODEL = "gemini-2.5-flash";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";

const PROMPT = `You are analyzing a wristwatch product variant image from a 1688 supplier listing. Look at the watch in the image and identify the visible attributes you can use to give the variant a customer-friendly name.

Identify each of these attributes (if visible):
- case color/finish (silver, gold, rose gold, two-tone gold-and-silver, black, etc.)
- dial color (white, black, blue, green, etc.)
- dial style (numerals, chronograph subdials, no-numerals, skeleton, etc.)
- strap color/material (black leather, brown leather, tan leather, etc.)
- bezel color (if distinctive — blue, green, black, etc.)
- any distinguishing feature (date window, three subdials, etc.)

Reply with ONLY strict minified JSON, no markdown:
{
  "caseColor": "Silver|Gold|Rose Gold|Two-Tone Gold and Silver|Black|...",
  "dialColor": "Black|White|Blue|Green|Cream|...",
  "strapColor": "Black Leather|Brown Leather|Tan Leather|...",
  "bezelColor": "Black|Blue|Green|None|...",
  "distinguishing": "short phrase or empty",
  "proposedName": "concise customer-friendly variant name combining the most distinctive attributes (e.g. 'Silver / Blue Dial / Brown Strap')"
}`;

interface Verdict {
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
      // Prefer Supabase storage URL if storagePath set; else use sourceUrl (alicdn).
      let imgUrl = v.featuredImage?.sourceUrl ?? "";
      if (v.featuredImage?.storagePath && SUPABASE_URL) {
        imgUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${v.featuredImage.storagePath}`;
      }
      return { v, imgUrl };
    });

    console.log(`\nClassifying ${inputs.length} variant images via Gemini (concurrency 4)...`);
    const results = await withConcurrency(inputs, 4, async ({ v, imgUrl }, idx) => {
      if (!imgUrl) return { v, verdict: null, error: "no image url" };
      try {
        const verdict = await classify(imgUrl);
        console.log(`  [${idx + 1}/${inputs.length}] #${v.position}: ${verdict.proposedName}`);
        return { v, verdict, error: null as string | null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  [${idx + 1}/${inputs.length}] #${v.position}: ERROR ${msg}`);
        return { v, verdict: null, error: msg };
      }
    });

    console.log("\n========== PROPOSED RENAMES ==========");
    const proposedNames = new Set<string>();
    const collisions: string[] = [];
    for (const r of results) {
      if (!r.verdict) {
        console.log(`#${r.v.position}  ERROR  ${r.error}`);
        continue;
      }
      const isDup = proposedNames.has(r.verdict.proposedName);
      if (isDup) collisions.push(`#${r.v.position}: ${r.verdict.proposedName}`);
      proposedNames.add(r.verdict.proposedName);
      console.log(
        `#${r.v.position.toString().padStart(2)}  case=${r.verdict.caseColor.padEnd(28)} dial=${r.verdict.dialColor.padEnd(14)} strap=${r.verdict.strapColor.padEnd(20)} bezel=${r.verdict.bezelColor.padEnd(12)} →  ${r.verdict.proposedName}${isDup ? "  [DUP]" : ""}`,
      );
    }

    console.log("\n========== ATTRIBUTE TALLIES ==========");
    const tally = (key: "caseColor" | "dialColor" | "strapColor" | "bezelColor") => {
      const map = new Map<string, number>();
      for (const r of results) {
        if (!r.verdict) continue;
        const v = r.verdict[key];
        map.set(v, (map.get(v) ?? 0) + 1);
      }
      console.log(`${key}:`);
      for (const [k, n] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${n.toString().padStart(2)}× ${k}`);
      }
    };
    tally("caseColor");
    tally("dialColor");
    tally("strapColor");
    tally("bezelColor");

    if (collisions.length > 0) {
      console.log("\n========== DUPLICATE PROPOSED NAMES ==========");
      for (const c of collisions) console.log(c);
    }

    const out = path.resolve(process.cwd(), ".tmp-classify", `watch-variants-${PID}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(results.map((r) => ({
      position: r.v.position, variantId: r.v.id, originalTitle: r.v.title,
      verdict: r.verdict, error: r.error,
    })), null, 2));
    console.log(`\nWrote ${out}`);
  } finally {
    await p.$disconnect();
  }
})();
