/**
 * Dogfood Phase 0b — apply the variant intelligence pass on cmq3nwk6g000jw2hst5cwxfj8:
 *   1. Retry Vision on variant #23 (errored on first pass)
 *   2. Set Product.productType = "watch"
 *   3. Set Product.optionNames = ["Dial Color", "Strap"]
 *   4. Unhide all 23 variants (pack-axis detector was a false positive)
 *   5. Set option1 = dialColor, option2 = strap (normalized) per Vision verdict
 *   6. Rewrite Variant.title to "{Dial} / {Strap}"
 *   7. Hide duplicate-name variants — keep lowest position in each cluster
 *
 * Reads .tmp-classify/watch-variants-<PID>.json produced by the prior pass.
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
const CACHE = path.resolve(process.cwd(), ".tmp-classify", `watch-variants-${PID}.json`);
const MODEL = "gemini-2.5-flash";

interface Cached {
  position: number;
  variantId: string;
  originalTitle: string;
  verdict: null | {
    caseColor: string; dialColor: string; strapColor: string;
    bezelColor: string; distinguishing: string; proposedName: string;
  };
  error: string | null;
}

function normalizeStrap(s: string): string {
  const v = s.trim().toLowerCase();
  if (v.includes("silver metal") || v === "silver") return "Stainless Steel Bracelet";
  if (v.includes("black leather")) return "Black Leather";
  if (v.includes("brown leather")) return "Brown Leather";
  if (v.includes("blue leather")) return "Blue Leather";
  if (v.includes("tan leather")) return "Tan Leather";
  // Default: Title Case
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeDial(s: string): string {
  const v = s.trim();
  if (!v) return "Black";
  // Title Case
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function retryVision(imageUrl: string): Promise<{ dialColor: string; strapColor: string; proposedName: string } | null> {
  const key = process.env.GEMINI_VISION_API_KEY;
  if (!key) return null;
  const PROMPT = `You are analyzing a wristwatch product variant image. Return ONLY JSON: {"dialColor":"...","strapColor":"...","proposedName":"..."}. Be specific about dial color and strap color/material.`;
  try {
    const res = await fetch(imageUrl);
    const ct = res.headers.get("content-type") || "image/png";
    const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    const body = {
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: buf.toString("base64") } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
    };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const firstBrace = cleaned.indexOf("{"); const lastBrace = cleaned.lastIndexOf("}");
    const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
    const p = JSON.parse(jsonStr);
    return { dialColor: String(p.dialColor ?? ""), strapColor: String(p.strapColor ?? ""), proposedName: String(p.proposedName ?? "") };
  } catch {
    return null;
  }
}

(async () => {
  if (!fs.existsSync(CACHE)) { console.error(`Cache missing: ${CACHE}`); process.exit(1); }
  const cached: Cached[] = JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  const prisma = new PrismaClient();

  // Step 1: retry #23 if errored
  const c23 = cached.find((c) => c.position === 23);
  if (c23 && !c23.verdict) {
    console.log("Retrying Vision on variant #23...");
    const v = await prisma.variant.findUnique({
      where: { id: c23.variantId },
      select: { featuredImage: { select: { sourceUrl: true } } },
    });
    if (v?.featuredImage?.sourceUrl) {
      const r = await retryVision(v.featuredImage.sourceUrl);
      if (r) {
        c23.verdict = { caseColor: "Silver", dialColor: r.dialColor, strapColor: r.strapColor, bezelColor: "", distinguishing: "", proposedName: r.proposedName };
        console.log(`  #23 → ${r.proposedName}`);
      } else {
        console.log("  #23 retry failed — will leave as 'Black / Black Leather' default and flag for user review");
        c23.verdict = { caseColor: "Silver", dialColor: "Black", strapColor: "Black Leather", bezelColor: "", distinguishing: "VISION-FAILED", proposedName: "Silver / Black Dial / Black Leather Strap" };
      }
    }
  }

  // Step 2 + 3: productType + optionNames
  console.log("\nUpdating Product.productType + optionNames...");
  await prisma.product.update({
    where: { id: PID },
    data: {
      productType: "watch",
      optionNames: JSON.stringify(["Dial Color", "Strap"]),
    },
  });
  console.log("  productType='watch', optionNames=[Dial Color, Strap]");

  // Step 4 + 5 + 6: per-variant updates
  console.log("\nApplying variant updates (rename + axis-split + unhide)...");
  const updates: Array<{ position: number; id: string; dial: string; strap: string; title: string }> = [];
  for (const c of cached) {
    if (!c.verdict) continue;
    const dial = normalizeDial(c.verdict.dialColor);
    const strap = normalizeStrap(c.verdict.strapColor);
    const title = `${dial} / ${strap}`;
    updates.push({ position: c.position, id: c.variantId, dial, strap, title });
  }

  // Step 7: identify duplicates (same dial+strap), keep lowest position
  const seen = new Map<string, number>(); // key -> earliest position
  const hideIds = new Set<string>();
  for (const u of updates) {
    const key = `${u.dial}|${u.strap}`;
    const prev = seen.get(key);
    if (prev === undefined) {
      seen.set(key, u.position);
    } else {
      hideIds.add(u.id);
    }
  }

  // Apply updates SEQUENTIALLY (connection_limit=1)
  for (const u of updates) {
    const hide = hideIds.has(u.id);
    await prisma.variant.update({
      where: { id: u.id },
      data: {
        title: u.title,
        option1: u.dial,
        option2: u.strap,
        isHidden: hide,
      },
    });
    console.log(`  #${u.position.toString().padStart(2)}  ${hide ? "HIDE " : "show "} → "${u.title}"`);
  }

  // Verify
  console.log("\nFinal variant state:");
  const after = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { position: true, title: true, option1: true, option2: true, isHidden: true },
  });
  const visible = after.filter((v) => !v.isHidden);
  console.log(`  ${visible.length} visible / ${after.length} total`);
  for (const v of after) {
    console.log(`  #${v.position.toString().padStart(2)}  ${v.isHidden ? "HIDE" : "show"}  ${v.option1} | ${v.option2}`);
  }

  await prisma.$disconnect();
})();
