/* Watch hero critic for cmq3j2mj20032w2p8arpaf42z */
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

const PID = "cmq3j2mj20032w2p8arpaf42z";
const MODEL = "gemini-2.5-flash";

const RUBRIC = `You are doing watch product-hero QA against the following rubric, distilled from the user's category-watches.md judgment file. Reply ONLY in strict minified JSON.

For each rule below, mark PASS or FAIL based on what you see in the image. If FAIL, briefly say what's visible.

Rules:
A) NO_TAG: no paper price tag, hang tag, certificate card, paper label, QR code, barcode, sticker, dangling string, or rectangular white paper anywhere in frame
B) NO_PROP: no cushion, pillow, watch roll, watch holder, display bust, fabric pad, velvet roll, or presentation box under or near the watch
C) UPRIGHT: watch case stands UPRIGHT at a 3/4 angle (dial rotated 25-30° off head-on, bracelet curving down). NOT flat-lay, NOT top-down, NOT pure side profile, NOT lying on caseback
D) LEGIBLE: crystal is glare-free and the dial face, hands, applied markers, brand text, and subdials are sharp and clearly legible
E) NO_PEOPLE: no people, no hands, no body parts in frame
F) NO_TEXT: no rendered text overlay, no watermark, no caption, no brand logo signage drawn on or near the image (the dial's own brand text is OK)
G) SCALE: case occupies roughly 40% of frame width, watch+bracelet ~70%, centered slightly above midpoint (not tiny in frame, not overfilling)

Return:
{"A":"pass|fail","A_detail":"","B":"pass|fail","B_detail":"","C":"pass|fail","C_detail":"","D":"pass|fail","D_detail":"","E":"pass|fail","E_detail":"","F":"pass|fail","F_detail":"","G":"pass|fail","G_detail":"","overall":"clean|minor|major"}`;

interface RubricResult {
  A: string; A_detail: string;
  B: string; B_detail: string;
  C: string; C_detail: string;
  D: string; D_detail: string;
  E: string; E_detail: string;
  F: string; F_detail: string;
  G: string; G_detail: string;
  overall: string;
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "image/png";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime, data: buf.toString("base64") };
}

async function classify(imageUrl: string): Promise<RubricResult> {
  const key = process.env.GEMINI_VISION_API_KEY!;
  const img = await fetchImageAsBase64(imageUrl);
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: img.mime, data: img.data } }, { text: RUBRIC }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const firstBrace = cleaned.indexOf("{"); const lastBrace = cleaned.lastIndexOf("}");
      const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
      return JSON.parse(jsonStr) as RubricResult;
    } catch (e) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
      else throw e;
    }
  }
  throw new Error("unreachable");
}

async function withConcurrency<T, R>(items: T[], limit: number, fn: (i: T, idx: number) => Promise<R>): Promise<R[]> {
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
  const heroes = await p.productImage.findMany({
    where: { productId: PID, imageType: { in: ["hero", "hero-flat"] } },
    select: { id: true, sourceUrl: true, storagePath: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${heroes.length} hero images for ${PID}`);

  const variants = await p.variant.findMany({
    where: { productId: PID, featuredImageId: { in: heroes.map((h) => h.id) } },
    select: { id: true, title: true, position: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  const variantByHero = new Map<string, typeof variants>();
  for (const v of variants) {
    if (!v.featuredImageId) continue;
    const arr = variantByHero.get(v.featuredImageId) ?? [];
    arr.push(v);
    variantByHero.set(v.featuredImageId, arr);
  }

  console.log(`Critiquing ${heroes.length} heroes (concurrency 4)...`);
  const results = await withConcurrency(heroes, 4, async (h, idx) => {
    try {
      const r = await classify(h.sourceUrl ?? "");
      const v = variantByHero.get(h.id)?.[0];
      console.log(`  [${idx + 1}/${heroes.length}] #${v?.position ?? "?"} ${v?.title ?? "—"}: ${r.overall}`);
      return { hero: h, variant: v, rubric: r, error: null as string | null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  [${idx + 1}/${heroes.length}] ERROR ${msg}`);
      return { hero: h, variant: null, rubric: null, error: msg };
    }
  });

  console.log("\n========== SUMMARY ==========");
  const counts = { clean: 0, minor: 0, major: 0, error: 0 };
  for (const r of results) {
    if (r.error) counts.error++;
    else if (r.rubric) counts[r.rubric.overall as keyof typeof counts]++;
  }
  console.log(`clean=${counts.clean}  minor=${counts.minor}  major=${counts.major}  error=${counts.error}`);

  console.log("\n========== PER-RULE FAILURES ==========");
  const ruleNames = { A: "NO_TAG", B: "NO_PROP", C: "UPRIGHT", D: "LEGIBLE", E: "NO_PEOPLE", F: "NO_TEXT", G: "SCALE" };
  for (const key of Object.keys(ruleNames) as Array<keyof typeof ruleNames>) {
    const fails = results.filter((r) => r.rubric && r.rubric[key] === "fail");
    if (fails.length === 0) continue;
    console.log(`\n${key} (${ruleNames[key]}) — ${fails.length} fail(s):`);
    for (const f of fails) {
      const detailKey = `${key}_detail` as keyof RubricResult;
      console.log(`  #${f.variant?.position ?? "?"} ${f.variant?.title ?? "—"}: ${f.rubric![detailKey]}`);
    }
  }

  await p.$disconnect();
})();
