/**
 * Variant Double-Checker — use Gemini Vision to verify each variant's option
 * value against its ACTUAL image, and re-derive accurate, customer-friendly
 * names for any that are wrong OR opaque (bare numbers/letters/SKUs).
 *
 * Driven by the `variant-double-checker` skill. Dry-run by default.
 *
 *   npx tsx scripts/_variant-double-check.ts --ids id1,id2        # specific products
 *   npx tsx scripts/_variant-double-check.ts --latest 10          # latest N scraped
 *   npx tsx scripts/_variant-double-check.ts --day 2026-06-04     # a scrape day (UTC)
 *   npx tsx scripts/_variant-double-check.ts --title "Table Lamp" # title substring
 *   ... add --apply to WRITE the renames (default is dry-run)
 *
 * Review URLs are fine too — pass the trailing id to --ids.
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

const KEY = process.env.GEMINI_API_KEY!;
const MODEL = "gemini-2.5-flash";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const publicUrl = (sp: string) => `${base}/storage/v1/object/public/${BUCKET}/${sp}`;
let tokIn = 0, tokOut = 0;

/** A label needs a vision-derived name when it's a bare/opaque supplier code. */
function isOpaque(label: string | null): boolean {
  const s = (label ?? "").trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) return true;                                   // 1, 2, 3…
  if (/^[A-Za-z]\d{0,2}$/.test(s) && !/^(S|M|L|XL?|XX?L)$/i.test(s)) return true; // A, A1, B2 (not sizes)
  if (/^(design|style|model|type|colou?r|option|variant|spec|item|no\.?)\s*[-_ ]?\s*[A-Za-z0-9]{1,3}$/i.test(s)) return true;
  if (/^[A-Z]{2,4}[-_]?\d{1,4}[A-Z]?$/.test(s)) return true;          // waffle SKU
  return false;
}

interface Check { index: number; actual: string; matches: boolean; proposed: string }

async function geminiCheck(title: string, axis: string, imgs: { mime_type: string; data: string }[], labels: string[]): Promise<Check[]> {
  const parts: Array<Record<string, unknown>> = [];
  imgs.forEach((d, i) => { parts.push({ text: `Image ${i + 1}:` }); parts.push({ inline_data: d }); });
  parts.push({ text: `These ${imgs.length} images are the variants of ONE product: "${title}" (option axis: "${axis || "Variant"}"). Each image has a CURRENT store label, listed below. For EACH image:
1. actual = describe the variant's real distinguishing attribute a shopper chooses on — colour / finish / material / style / shape (be specific, e.g. "Rose gold case, white dial", "Walnut wood, square").
2. matches = does the CURRENT label accurately describe what you SEE? Set false when the label is clearly WRONG (e.g. "Blue" but it's red) OR when the label is an opaque code with no customer meaning (a bare number, single letter, or supplier SKU).
3. proposed = a concise, accurate, customer-friendly name (1-4 words, Title Case) for THIS variant based on the photo. Make all ${imgs.length} proposed names DISTINCT so every variant is differentiable.

Current labels:
${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}

Return ONLY strict minified JSON, no markdown: {"checks":[{"index":1,"actual":"...","matches":true|false,"proposed":"..."}, ...]} one entry per image.` });
  const body = { contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } } };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    tokIn += json.usageMetadata?.promptTokenCount ?? 0; tokOut += json.usageMetadata?.candidatesTokenCount ?? 0;
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    const mm = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").match(/\{[\s\S]*\}/);
    return (JSON.parse(mm ? mm[0] : text) as { checks: Check[] }).checks;
  }
  throw new Error("Gemini retries exhausted (rate limit?)");
}

async function resolveIds(prisma: import("@prisma/client").PrismaClient): Promise<string[]> {
  const argv = process.argv;
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const ids = get("--ids");
  if (ids) return ids.split(",").map((s) => s.trim().replace(/.*\/review\//, "")).filter(Boolean);
  const title = get("--title");
  if (title) return (await prisma.product.findMany({ where: { title: { contains: title } }, orderBy: { createdAt: "desc" }, select: { id: true } })).map((p) => p.id);
  const day = get("--day");
  if (day) return (await prisma.scrapeJob.findMany({ where: { createdAt: { gte: new Date(`${day}T00:00:00Z`), lte: new Date(`${day}T23:59:59Z`) }, product: { isNot: null } }, orderBy: { createdAt: "asc" }, select: { product: { select: { id: true } } } })).map((j) => j.product!.id);
  const latest = get("--latest");
  const n = latest ? parseInt(latest, 10) : 5;
  return (await prisma.scrapeJob.findMany({ where: { product: { isNot: null } }, orderBy: { createdAt: "desc" }, take: n, select: { product: { select: { id: true } } } })).map((j) => j.product!.id);
}

async function main() {
  if (!KEY) { console.error("GEMINI_API_KEY not set"); process.exit(1); }
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../src/lib/db");
  const ids = await resolveIds(prisma);
  console.log(`Double-checking ${ids.length} product(s) with Gemini Vision.  ${apply ? "APPLY mode" : "DRY-RUN"}\n`);

  let totalChanges = 0; const splitHints: string[] = [];
  for (let n = 0; n < ids.length; n++) {
    const p = await prisma.product.findUnique({ where: { id: ids[n] }, select: { title: true, optionNames: true, variants: { where: { isHidden: false }, orderBy: { position: "asc" }, select: { id: true, position: true, option1: true, option2: true, option3: true, featuredImageId: true } }, images: { select: { id: true, storagePath: true, sourceUrl: true } } } });
    if (!p) { console.log(`[${n + 1}/${ids.length}] ${ids[n]} — not found`); continue; }
    const axis = (() => { try { return (JSON.parse(p.optionNames ?? "[]")[0]) ?? "Variant"; } catch { return "Variant"; } })();
    const im = new Map(p.images.map((i) => [i.id, i]));
    const items = p.variants.map((v) => { const img = v.featuredImageId ? im.get(v.featuredImageId) : null; return { v, url: img ? (img.storagePath ? publicUrl(img.storagePath) : img.sourceUrl) : null }; }).filter((x) => x.url) as Array<{ v: (typeof p.variants)[number]; url: string }>;
    if (items.length < 1) { console.log(`[${n + 1}/${ids.length}] ${(p.title ?? "").slice(0, 44)}  (no variant images)`); continue; }
    try {
      const imgs = await Promise.all(items.map(async ({ url }) => { const r = await fetch(url); const b = Buffer.from(await r.arrayBuffer()); const z = await sharp(b).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); return { mime_type: "image/jpeg", data: z.toString("base64") }; }));
      const checks = await geminiCheck(p.title ?? "", axis, imgs, items.map((x) => x.v.option1 ?? ""));
      const changes: Array<{ v: (typeof items)[number]["v"]; from: string; to: string; reason: string }> = [];
      for (const c of checks) {
        const it = items[c.index - 1]; if (!it) continue;
        const cur = it.v.option1 ?? "";
        const opaque = isOpaque(cur);
        const want = (c.matches === false || opaque) && c.proposed && c.proposed.trim() && c.proposed.trim() !== cur;
        if (want) changes.push({ v: it.v, from: cur, to: c.proposed.trim(), reason: opaque ? "opaque code" : "mismatch" });
      }
      console.log(`[${n + 1}/${ids.length}] ${items.length} variant(s)  ${changes.length === 0 ? "✓ all accurate" : `⚠ ${changes.length} to fix`}  ${(p.title ?? "").slice(0, 44)}`);
      for (const ch of changes) console.log(`     pos ${ch.v.position}: "${ch.from}" → "${ch.to}"  (${ch.reason})`);
      if (apply) for (const ch of changes) { const title = [ch.to, ch.v.option2, ch.v.option3].filter(Boolean).join(" / "); await prisma.variant.update({ where: { id: ch.v.id }, data: { option1: ch.to, title } }); }
      totalChanges += changes.length;
      // Axis-split hint: most proposed names share an "A / B" two-part shape → could be 2 axes.
      const twoPart = checks.filter((c) => /\s\/\s|,\s/.test(c.proposed)).length;
      if (items.length >= 3 && twoPart >= Math.ceil(items.length * 0.7)) splitHints.push(`${p.id} (${p.title?.slice(0, 40)}) — values look two-dimensional; consider splitting "${axis}" into 2 axes.`);
    } catch (err) {
      console.log(`[${n + 1}/${ids.length}] ${(p.title ?? "").slice(0, 44)}  ERROR — ${err instanceof Error ? err.message : err}`);
    }
    if (n < ids.length - 1) await new Promise((r) => setTimeout(r, 4000)); // rate-limit spacing
  }

  console.log(`\n=== ${apply ? "APPLIED" : "DRY-RUN"}: ${totalChanges} variant rename(s) across ${ids.length} product(s) ===`);
  if (splitHints.length) { console.log(`\nAxis-split candidates (would make extra columns clearer — review manually):`); for (const h of splitHints) console.log("  • " + h); }
  console.log(`\nGemini tokens: in ${tokIn} / out ${tokOut}  (~$${((tokIn / 1e6) * 0.3 + (tokOut / 1e6) * 2.5).toFixed(4)})`);
  if (!apply && totalChanges > 0) console.log("Re-run with --apply to write. (Spot-check a few images first.)");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
