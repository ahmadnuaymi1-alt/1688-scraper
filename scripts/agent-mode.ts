/**
 * agent-mode.ts — single-product chained orchestrator for the 1688 → Shopify pipeline.
 *
 * Bakes in the proven non-concurrency speedups: run the whole mechanical pipeline
 * in ONE process (zero hand-off latency) and overlap the off-critical-path work
 * (pricing, non-image rules, delete-originals) with image generation. Validated:
 * single-variant watch finished in ~3:44 this way vs ~11:50 as separate manual steps.
 *
 * Two modes:
 *   FRONT:  npx tsx scripts/agent-mode.ts --from-url "<1688 url>"
 *           Phase-1 scrape → Phase-2 audit → set productType → print HANDOFF + exit.
 *           (Variant intelligence + scene-overrides authoring stay Claude-driven; do
 *            them between FRONT and TAIL, then call TAIL.)
 *
 *   TAIL:   npx tsx scripts/agent-mode.ts <productId> [--concurrency N] [--force-lifestyles] [--no-pricing]
 *           STAGE A heroes → STAGE B { lifestyles+closeup ∥ pricing→desc/title/tags/seo ∥ delete-originals }
 *           → STAGE C image rule → STAGE D inspect + flags + /review URL.
 *
 * Multi-product: launch one TAIL per product in parallel with HIGGSFIELD_MAX_INFLIGHT=8
 * in the environment — the global file-token gate (scripts/_hf-inflight-gate.ts) keeps
 * TOTAL in-flight image generations <= 8 across all processes while keeping all 8 busy.
 *
 * Scope guard: this is an ADDITIVE agent-mode orchestrator. It drives existing scripts/
 * services unchanged; default (non-agent-mode) scraper behavior is untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace("T", " ").replace("Z", "");
function stamp(label: string) { console.log(`[${nowIso()}] ${label}`); }

/** Spawn `npx tsx <script> <args...>`, streaming output; resolve with exit code. */
function runScript(scriptRel: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", scriptRel, ...args], { stdio: "inherit", shell: true });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", () => resolve(-1));
  });
}

/** Retry a DB op on transient Supabase pooler errors (ETIMEDOUT/ENOTFOUND/etc). */
async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /ETIMEDOUT|ENOTFOUND|ECONNRESET|Can't reach database|connection|pool/i.test(msg);
      if (i < attempts && transient) {
        console.log(`  [retry ${label} ${i}/${attempts}] ${msg.slice(0, 90)}`);
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`unreachable`);
}

const APPLY_TIERS = new Set(["launch", "stretch", "bundle"]);
function resolveApplyTier(notes: any): "launch" | "stretch" | "bundle" {
  let raw: any = notes?.recommended?.label ?? notes?.recommendedTier ?? notes?.recommended_tier ?? "launch";
  raw = typeof raw === "string" ? raw.trim() : "launch";
  return APPLY_TIERS.has(raw) ? raw : "launch"; // compareAt / unknown → launch
}

/** Delete 1688 originals — mirrors src/app/api/products/[id]/delete-originals/route.ts exactly. */
async function deleteOriginals(prisma: PrismaClient, productId: string): Promise<{ deleted: number; kept: number }> {
  const candidates = await withDbRetry("del-find", () =>
    prisma.productImage.findMany({
      where: { productId, imageType: null, keep: false },
      select: { id: true, sourceUrl: true, storagePath: true },
    }),
  );
  const originals = candidates.filter((img) => {
    try {
      const host = new URL(img.sourceUrl).hostname;
      return host.endsWith(".alicdn.com") || host === "alicdn.com";
    } catch {
      return false;
    }
  });
  const kept = await withDbRetry("del-keptcount", () =>
    prisma.productImage.count({ where: { productId, imageType: null, keep: true } }),
  );
  if (originals.length === 0) return { deleted: 0, kept };

  // Best-effort storage cleanup (non-fatal), then DB delete.
  const paths = originals.map((o) => o.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
      if (url && key) {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) console.warn(`  [delete-originals] storage remove failed (non-fatal): ${error.message}`);
      }
    } catch (e) {
      console.warn(`  [delete-originals] storage remove threw (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
  }
  // Defensive: detach any variant still pointing at a to-be-deleted original.
  for (const o of originals) {
    await withDbRetry("del-detach", () => prisma.variant.updateMany({ where: { featuredImageId: o.id }, data: { featuredImageId: null } }));
  }
  const result = await withDbRetry("del-deletemany", () =>
    prisma.productImage.deleteMany({ where: { id: { in: originals.map((o) => o.id) } } }),
  );
  return { deleted: result.count, kept };
}

/** Pricing: recalculate (with retry for the known JSON-preamble flakiness) then apply. */
async function runPricing(prisma: PrismaClient, productId: string): Promise<{ ok: boolean; tier?: string; note?: string }> {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  let ok = false;
  let lastErr = "";
  for (let a = 1; a <= 4 && !ok; a++) {
    try {
      await recalculatePricing(productId, DEFAULT_SCRAPE_OPTIONS);
      ok = true;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.log(`  [pricing attempt ${a}/4] ${lastErr.slice(0, 120)}`);
      await sleep(2000 * a);
    }
  }
  if (!ok) return { ok: false, note: `recalculatePricing failed 4x: ${lastErr.slice(0, 120)}` };
  const p = await withDbRetry("price-read", () => prisma.product.findUnique({ where: { id: productId }, select: { pricingNotes: true } }));
  let notes: any = p?.pricingNotes ?? null;
  if (typeof notes === "string") { try { notes = JSON.parse(notes); } catch { /* leave */ } }
  const tier = resolveApplyTier(notes);
  await applyPricingToVariants(productId, tier as any, DEFAULT_SCRAPE_OPTIONS);
  return { ok: true, tier };
}

// ── FRONT: --from-url (scrape → phase2 → productType → HANDOFF) ───────────────
async function runFromUrl(url: string): Promise<void> {
  const { handleScrapeJob, handleRulesJob } = await import("../src/services/scraper.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();
  stamp(`FRONT start ${url}`);

  const recent = await prisma.scrapeJob.findFirst({ orderBy: { createdAt: "desc" }, select: { userId: true } });
  if (!recent) { console.error("No existing ScrapeJob → cannot resolve userId"); process.exit(1); }
  const job = await prisma.scrapeJob.create({
    data: { userId: recent.userId, sourceUrl: url, status: "pending", options: JSON.stringify(DEFAULT_SCRAPE_OPTIONS) },
    select: { id: true },
  });
  stamp(`scrape (Phase 1) job=${job.id}`);
  await handleScrapeJob(job.id, url);
  stamp(`phase2 (audit/enrich)`);
  await handleRulesJob(job.id);

  const product = await prisma.product.findUnique({ where: { scrapeJobId: job.id }, select: { id: true, title: true, productType: true } });
  if (!product) { console.error("No product after scrape"); process.exit(1); }

  // Auto-set productType from existing classifiers (mainly so heroes pick the
  // right category prompt). Never overwrite a non-null value. Best-effort.
  if (!product.productType) {
    try {
      const { isWatchProduct, isLightingProduct } = await import("../src/services/lifestyle-scene-designer.service");
      const text = `${product.title}`;
      const type = isWatchProduct(text) ? "watch" : isLightingProduct(text) ? "lighting" : null;
      if (type) {
        await prisma.product.update({ where: { id: product.id }, data: { productType: type } });
        stamp(`productType set → ${type}`);
      } else {
        stamp(`productType left null (classifier unsure — set it in the variant step)`);
      }
    } catch (e) {
      stamp(`productType classify skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  await prisma.$disconnect();
  console.log(`\n===== HANDOFF productId=${product.id} title="${product.title}" =====`);
  console.log(`Next (Claude-driven): variant intelligence + dimension check + scene-overrides (non-lighting),`);
  console.log(`then run:  npx tsx scripts/agent-mode.ts ${product.id}`);
}

// ── TAIL: <productId> (heroes → parallel B → image rule → inspect) ────────────
async function runTail(productId: string, concurrency: number, forceLifestyles: boolean, doPricing: boolean): Promise<void> {
  const prisma = new PrismaClient();
  const flags: string[] = [];
  stamp(`TAIL start ${productId} (concurrency=${concurrency})`);

  const product = await withDbRetry("load", () =>
    prisma.product.findUnique({ where: { id: productId }, include: { variants: true, images: true } }),
  );
  if (!product) { console.error(`product ${productId} not found`); process.exit(1); }
  if (!product.productType) flags.push("productType is null — heroes used the general (non-watch/lighting) prompt");

  // STAGE A — heroes (built-in Gemini source-match auto-regen runs inside the script)
  stamp("STAGE A heroes →");
  const heroCode = await runScript("scripts/_hero-image-creator.ts", [productId, "--concurrency", String(concurrency)]);
  if (heroCode !== 0) flags.push(`hero script exited ${heroCode} (some heroes may be missing)`);
  stamp("STAGE A heroes done");

  // STAGE B — lifestyles ∥ (pricing→desc/title/tags/seo) ∥ delete-originals
  stamp("STAGE B parallel { lifestyles | pricing+rules | delete } →");
  const existingLifestyles = await withDbRetry("ls-count", () =>
    prisma.productImage.count({ where: { productId, imageType: "lifestyle" } }),
  );

  const b1LifestylesThenDelete = (async () => {
    if (existingLifestyles >= 6 && !forceLifestyles) {
      stamp(`  B1 lifestyles SKIPPED (already ${existingLifestyles}; pass --force-lifestyles to regen)`);
    } else {
      const code = await runScript("scripts/_lifestyle-image-creator.ts", [productId, "--concurrency", String(concurrency)]);
      if (code !== 0) flags.push(`lifestyle script exited ${code}`);
      stamp("  B1 lifestyles+closeup done");
    }
    // delete-originals runs AFTER lifestyles+closeup (the closeup needs an original
    // source image; deleting concurrently was a race that wiped 0-closeup products).
    const r = await deleteOriginals(prisma, productId);
    stamp(`  B1 delete-originals: deleted ${r.deleted}, kept(starred) ${r.kept}`);
  })();

  const b23PricingThenRules = (async () => {
    if (doPricing) {
      const pr = await runPricing(prisma, productId);
      if (pr.ok) stamp(`  B2 pricing applied tier=${pr.tier}`);
      else { flags.push(pr.note ?? "pricing failed"); stamp(`  B2 pricing FAILED — ${pr.note}`); }
    } else {
      stamp("  B2 pricing skipped (--no-pricing)");
    }
    // B3 must follow B2 — the description rule embeds live variant prices.
    const { reapplyRules } = await import("../src/services/rule.service");
    await reapplyRules(productId, ["description", "title", "tags", "seo"] as any);
    stamp("  B3 reapply [description,title,tags,seo] done");
  })();

  const settled = await Promise.allSettled([b1LifestylesThenDelete, b23PricingThenRules]);
  settled.forEach((s, i) => { if (s.status === "rejected") flags.push(`STAGE B branch ${i} rejected: ${String(s.reason).slice(0, 120)}`); });
  stamp("STAGE B done");

  // STAGE C — image rule LAST (needs clean gallery: originals gone + heroes/lifestyles present)
  stamp("STAGE C image rule →");
  try {
    const { reapplyRules } = await import("../src/services/rule.service");
    await reapplyRules(productId, ["image"] as any);
    stamp("STAGE C image rule done");
  } catch (e) {
    flags.push(`image rule failed: ${e instanceof Error ? e.message : e}`);
  }

  // STAGE C.5 — gallery preset order (canonical Shopify-upload arrangement)
  stamp("STAGE C.5 gallery preset →");
  try {
    const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");
    await applyGalleryPreset(productId);
    stamp("STAGE C.5 gallery preset done");
  } catch (e) {
    flags.push(`gallery preset failed: ${e instanceof Error ? e.message : e}`);
  }

  // STAGE D — inspect + summary
  const final: any = await withDbRetry("final", () => prisma.product.findUnique({ where: { id: productId }, include: { variants: true, images: true } }));
  const byType = final.images.reduce((a: any, i: any) => { const k = i.imageType ?? "(source)"; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const survivingAlicdn = final.images.filter((i: any) => i.imageType === null && (() => { try { return new URL(i.sourceUrl).hostname.endsWith(".alicdn.com"); } catch { return false; } })()).length;
  const visible = final.variants.filter((v: any) => !v.isHidden).length;

  await prisma.$disconnect();

  console.log(`\n================= AGENT-MODE TAIL COMPLETE =================`);
  console.log(`Title: ${final.title}`);
  console.log(`ProductType: ${final.productType} | visible variants: ${visible}/${final.variants.length}`);
  console.log(`Images byType: ${JSON.stringify(byType)} | surviving .alicdn originals: ${survivingAlicdn}`);
  console.log(`descriptionHtml len: ${(final.descriptionHtml ?? "").length}`);
  for (const v of final.variants.filter((v: any) => !v.isHidden)) console.log(`  #${v.position} ${v.option1} $${v.price} compareAt=${v.compareAtPrice ?? "null"}`);
  if (flags.length) { console.log(`\nFLAGS (review):`); for (const f of flags) console.log(`  ⚠ ${f}`); }
  else console.log(`\nNo flags.`);
  console.log(`\nReady: /review/${productId}`);
}

// ── entry ────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const fromUrlIdx = argv.indexOf("--from-url");
  if (fromUrlIdx !== -1) {
    const url = argv[fromUrlIdx + 1];
    if (!url) { console.error("usage: agent-mode.ts --from-url \"<url>\""); process.exit(1); }
    await runFromUrl(url);
    return;
  }
  const productId = argv.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
  if (!productId) { console.error("usage: agent-mode.ts <productId> [--concurrency N] [--force-lifestyles] [--no-pricing]   OR   --from-url \"<url>\""); process.exit(1); }
  let concurrency = 6;
  const cIdx = argv.indexOf("--concurrency");
  if (cIdx !== -1) { const n = parseInt(argv[cIdx + 1], 10); if (Number.isFinite(n) && n > 0) concurrency = n; }
  const forceLifestyles = argv.includes("--force-lifestyles");
  const doPricing = !argv.includes("--no-pricing");
  await runTail(productId, concurrency, forceLifestyles, doPricing);
}

main().catch((e) => { console.error(e); process.exit(1); });
