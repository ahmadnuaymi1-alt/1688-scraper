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

const PID = "cmpzifo4s003uw2hsxm35vqyf";
const MODEL = "gemini-2.5-flash";
const CONCURRENCY = 4;

const PROMPT = `You are doing watch product-image QA. The image shows a wrist watch hero shot.

Classify the image as GOOD or BAD based on these rules:

GOOD = watch case is standing upright in roughly a 3/4 angled view (you can see the dial face clearly); the bracelet/band curves down and back behind the case; the dial is clearly readable; NOTHING is wrapped or draped around the watch (no cushion, pillow, watch roll, watch holder, display bust, fabric pad, or velvet roll under or through the band); the case occupies a reasonable portion of the frame (not tiny, not over-filling the frame).

BAD = ANY of the following:
- Watch lying flat on its caseback (top-down "flat-lay" view where you're looking straight down at the dial with the band laid out flat).
- Watch wrapped / draped / curled around a cushion, pillow, watch roll, watch holder, display bust, fabric pad, or velvet roll.
- Watch shown only in pure side profile with the dial face hidden / not visible.
- Case is dramatically smaller (looks lost in frame) or dramatically larger (overfills the frame) compared to a normal product-hero scale.

Reply with ONLY strict minified JSON, no markdown:
{"verdict":"good|bad","reason":"short tag like flat-lay / watch-cushion / watch-roll / wrong-angle / pure-profile / too-small / too-large / ok","detail":"one-line description of what you see"}`;

interface VerdictResult {
  verdict: "good" | "bad" | "uncertain";
  reason: string;
  detail: string;
  raw: string;
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const ct = res.headers.get("content-type") || "image/png";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime, data: buf.toString("base64") };
}

async function classifyImage(imageUrl: string): Promise<VerdictResult> {
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
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (json?.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p?.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error(`Empty response: ${JSON.stringify(json).slice(0, 300)}`);

      // Strip markdown fences if any
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
      const parsed = JSON.parse(jsonStr) as { verdict?: string; reason?: string; detail?: string };
      const rawVerdict = String(parsed.verdict ?? "").trim().toLowerCase();
      const verdict: "good" | "bad" | "uncertain" =
        rawVerdict === "good" || rawVerdict === "bad" ? rawVerdict : "uncertain";
      if (verdict === "uncertain") {
        console.log(`    [debug uncertain] raw verdict=${JSON.stringify(parsed.verdict)} full=${text.slice(0, 200)}`);
      }
      return {
        verdict,
        reason: String(parsed.reason ?? ""),
        detail: String(parsed.detail ?? ""),
        raw: text,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  const p = new PrismaClient();
  try {
    if (!process.env.GEMINI_VISION_API_KEY) {
      console.error("ERROR: GEMINI_VISION_API_KEY not set in env");
      process.exit(1);
    }

    // 1. Get all hero-flat ProductImage rows for the product
    const heroes = await p.productImage.findMany({
      where: { productId: PID, imageType: "hero-flat" },
      select: { id: true, sourceUrl: true, storagePath: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`Found ${heroes.length} hero-flat images for product ${PID}`);

    // 2. Find variants that point at each hero (featuredImageId)
    const variants = await p.variant.findMany({
      where: { productId: PID, featuredImageId: { in: heroes.map((h) => h.id) } },
      select: { id: true, title: true, featuredImageId: true, isHidden: true, position: true },
      orderBy: { position: "asc" },
    });

    const variantByHeroId = new Map<string, typeof variants>();
    for (const v of variants) {
      if (!v.featuredImageId) continue;
      const arr = variantByHeroId.get(v.featuredImageId) ?? [];
      arr.push(v);
      variantByHeroId.set(v.featuredImageId, arr);
    }

    type Row = {
      heroImageId: string;
      sourceUrl: string;
      storagePath: string | null;
      variantId: string;
      variantTitle: string;
    };
    const rows: Row[] = [];
    for (const h of heroes) {
      const vs = variantByHeroId.get(h.id) ?? [];
      if (vs.length === 0) {
        rows.push({
          heroImageId: h.id,
          sourceUrl: h.sourceUrl ?? "",
          storagePath: h.storagePath ?? null,
          variantId: "(no-variant-attached)",
          variantTitle: "(no-variant-attached)",
        });
      } else {
        // If multiple variants share this hero, list each (we still only classify the image once).
        for (const v of vs) {
          rows.push({
            heroImageId: h.id,
            sourceUrl: h.sourceUrl ?? "",
            storagePath: h.storagePath ?? null,
            variantId: v.id,
            variantTitle: v.title ?? "",
          });
        }
      }
    }
    console.log(`Total rows (hero × variant attachments): ${rows.length}`);

    // Dedupe heroes — only classify once per unique heroImageId
    const uniqueHeroes = heroes;
    console.log(`Classifying ${uniqueHeroes.length} unique heroes via Gemini (concurrency ${CONCURRENCY})...`);

    const classifications = await withConcurrency(uniqueHeroes, CONCURRENCY, async (h, idx) => {
      try {
        const r = await classifyImage(h.sourceUrl ?? "");
        console.log(`  [${idx + 1}/${uniqueHeroes.length}] ${h.id}: ${r.verdict.toUpperCase()} — ${r.reason} — ${r.detail}`);
        return { heroImageId: h.id, ...r };
      } catch (err) {
        console.error(`  [${idx + 1}/${uniqueHeroes.length}] ${h.id}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
        return {
          heroImageId: h.id,
          verdict: "uncertain" as const,
          reason: "error",
          detail: err instanceof Error ? err.message : String(err),
          raw: "",
        };
      }
    });

    const classByHero = new Map<string, (typeof classifications)[number]>();
    for (const c of classifications) classByHero.set(c.heroImageId, c);

    // Build final output: per-row with classification
    const final = rows.map((r) => {
      const c = classByHero.get(r.heroImageId);
      return {
        heroImageId: r.heroImageId,
        variantId: r.variantId,
        variantTitle: r.variantTitle,
        sourceUrl: r.sourceUrl,
        verdict: c?.verdict ?? "uncertain",
        reason: c?.reason ?? "",
        detail: c?.detail ?? "",
      };
    });

    // Dedupe by heroImageId for counting (one verdict per hero)
    const uniqueByHero = new Map<string, (typeof final)[number]>();
    for (const f of final) {
      if (!uniqueByHero.has(f.heroImageId)) uniqueByHero.set(f.heroImageId, f);
    }
    const uniqueFinal = Array.from(uniqueByHero.values());

    const good = uniqueFinal.filter((r) => r.verdict === "good").length;
    const bad = uniqueFinal.filter((r) => r.verdict === "bad").length;
    const uncertain = uniqueFinal.filter((r) => r.verdict === "uncertain").length;

    console.log("\n========== SUMMARY ==========");
    console.log(`Total unique heroes: ${uniqueFinal.length}`);
    console.log(`GOOD: ${good}`);
    console.log(`BAD : ${bad}`);
    console.log(`UNCERTAIN: ${uncertain}`);

    console.log("\n========== ALL ATTACHMENTS ==========");
    for (const f of final) {
      console.log(`${f.verdict.toUpperCase().padEnd(10)} ${f.heroImageId}  variant=${f.variantId}  "${f.variantTitle}"  reason=${f.reason}`);
    }

    console.log("\n========== BAD HEROES (with variant attachments) ==========");
    const badRows = final.filter((r) => r.verdict === "bad");
    for (const f of badRows) {
      console.log(JSON.stringify(f));
    }

    // Persist results to disk for the next phase to consume
    const outPath = path.resolve(process.cwd(), ".tmp-classify", `watch-${PID}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          productId: PID,
          model: MODEL,
          totalHeroes: uniqueFinal.length,
          goodCount: good,
          badCount: bad,
          uncertainCount: uncertain,
          rows: final,
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote results to ${outPath}`);
  } finally {
    await p.$disconnect();
  }
})();
