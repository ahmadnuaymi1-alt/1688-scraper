/**
 * READ-ONLY colour audit. For every product scraped on DAY (default today),
 * send all variant images to Gemini Vision and ask whether each CURRENT colour
 * label actually matches the photo. Flags products with clear mismatches and
 * prints their review URLs. Never writes to the DB.
 *
 *   npx tsx scripts/_audit-colors.ts            # DAY=2026-06-04
 *   DAY=2026-06-04 npx tsx scripts/_audit-colors.ts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, ""); if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const DAY = process.env.DAY || "2026-06-04";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const MODEL = "gemini-2.5-flash";
const KEY = process.env.GEMINI_API_KEY!;
const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const publicUrl = (sp: string) => `${base}/storage/v1/object/public/${BUCKET}/${sp}`;
let tokIn = 0, tokOut = 0;

async function geminiAudit(title: string, imgs: { mime_type: string; data: string }[], labels: string[]): Promise<Array<{ index: number; actual: string; matches: boolean }>> {
  const parts: Array<Record<string, unknown>> = [];
  imgs.forEach((d, i) => { parts.push({ text: `Image ${i + 1}:` }); parts.push({ inline_data: d }); });
  parts.push({ text: `These ${imgs.length} images are colour variants of ONE watch: "${title}". Each has a CURRENT store label. For EACH image: (1) read the watch's actual dominant colour from the photo (case/band metal + dial/bezel colour); (2) decide if the CURRENT label reasonably matches what a shopper sees. Set matches=false ONLY when the label is clearly WRONG (e.g. labelled "Blue" but it's red, "Brown" but it's silver) — NOT for mere detail/format differences (a "Gold" label on a gold watch with a green dial still MATCHES).

Current labels:
${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}

Return ONLY strict minified JSON, no markdown: {"checks":[{"index":1,"actual":"...","matches":true|false}, ...]} one entry per image.` });
  const body = { contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } } };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    tokIn += json.usageMetadata?.promptTokenCount ?? 0; tokOut += json.usageMetadata?.candidatesTokenCount ?? 0;
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    const m = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").match(/\{[\s\S]*\}/);
    return (JSON.parse(m ? m[0] : text) as { checks: Array<{ index: number; actual: string; matches: boolean }> }).checks;
  }
  throw new Error("Gemini retries exhausted");
}

async function main() {
  if (!KEY) { console.error("GEMINI_API_KEY not set"); process.exit(1); }
  const { prisma } = await import("../src/lib/db");
  const onlyPid = process.env.PID;
  const jobs = await prisma.scrapeJob.findMany({
    where: onlyPid
      ? { product: { id: onlyPid } }
      : { createdAt: { gte: new Date(`${DAY}T00:00:00Z`), lte: new Date(`${DAY}T23:59:59Z`) }, product: { isNot: null } },
    orderBy: { createdAt: "asc" },
    select: { product: { select: { id: true, title: true, variants: { where: { isHidden: false }, orderBy: { position: "asc" }, select: { position: true, option1: true, featuredImageId: true } }, images: { select: { id: true, storagePath: true, sourceUrl: true } } } } },
  });
  console.log(`Auditing ${jobs.length} product(s) scraped ${DAY}…\n`);
  const flagged: Array<{ id: string; title: string; mism: Array<{ pos: number; label: string; actual: string }> }> = [];

  for (let n = 0; n < jobs.length; n++) {
    const p = jobs[n].product!;
    const im = new Map(p.images.map((i) => [i.id, i]));
    const items = p.variants.map((v) => { const img = v.featuredImageId ? im.get(v.featuredImageId) : null; return { v, url: img ? (img.storagePath ? publicUrl(img.storagePath) : img.sourceUrl) : null }; }).filter((x) => x.url) as Array<{ v: (typeof p.variants)[number]; url: string }>;
    if (items.length === 0) { console.log(`[${n + 1}/${jobs.length}] ${p.id}  (no variant images — skipped)`); continue; }
    try {
      const imgs = await Promise.all(items.map(async ({ url }) => { const r = await fetch(url); const b = Buffer.from(await r.arrayBuffer()); const z = await sharp(b).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); return { mime_type: "image/jpeg", data: z.toString("base64") }; }));
      const checks = await geminiAudit(p.title ?? "", imgs, items.map((x) => x.v.option1 ?? ""));
      const mism = checks.filter((c) => c.matches === false).map((c) => ({ pos: items[c.index - 1]?.v.position ?? c.index, label: items[c.index - 1]?.v.option1 ?? "?", actual: c.actual }));
      console.log(`[${n + 1}/${jobs.length}] ${items.length} variant(s)  ${mism.length === 0 ? "✓ all match" : `⚠ ${mism.length} MISMATCH`}  ${(p.title ?? "").slice(0, 46)}`);
      if (mism.length) flagged.push({ id: p.id, title: p.title ?? "", mism });
    } catch (err) {
      console.log(`[${n + 1}/${jobs.length}] ${p.id}  ERROR — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n=== RESULT ===`);
  if (flagged.length === 0) {
    console.log("All products' colour labels match their images. Nothing to change. ✓");
  } else {
    console.log(`${flagged.length} product(s) have colour mismatches:\n`);
    for (const f of flagged) {
      console.log(`• ${f.title.slice(0, 55)}`);
      console.log(`  http://localhost:3000/review/${f.id}`);
      for (const m of f.mism) console.log(`     pos ${m.pos}: "${m.label}"  → actually ${m.actual}`);
    }
  }
  console.log(`\nGemini tokens: in ${tokIn} / out ${tokOut}  (~$${((tokIn / 1e6) * 0.3 + (tokOut / 1e6) * 2.5).toFixed(4)})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
