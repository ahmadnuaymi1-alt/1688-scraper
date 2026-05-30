/**
 * Lifestyle-from-lifestyle generator.
 *
 * Picks the lowest-position lifestyle ProductImage for each input product and
 * uses IT (not the hero) as the reference media_input fed to Higgsfield CLI.
 * For each product, fires 6 generations in parallel — minimal prompt: "make a
 * lifestyle image of this product" + a distinct camera angle directive per
 * slot. No environment is specified — the reference image tells the model
 * what the product looks like in context; the model picks its own scene.
 *
 * Wipes existing lifestyle rows for each product before persisting the new
 * ones — so each product ends up with exactly 6 fresh lifestyle entries.
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-from-lifestyle.ts --products id1,id2,...
 *
 * The script fires all products in PARALLEL (per bulk-ops-parallel rule).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const REF_CACHE = path.join(os.tmpdir(), "hf-lifestyle-from-lifestyle", "refs");

const prisma = new PrismaClient();
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supabase;
}
function publicSupabaseUrlFromPath(p: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}
async function uploadToSupabase(buf: Buffer, storagePath: string): Promise<string> {
  const { error } = await getSupabase().storage.from(BUCKET).upload(storagePath, buf, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return publicSupabaseUrlFromPath(storagePath);
}

// ── Higgsfield CLI ─────────────────────────────────────────────────────────
function runHiggsfield(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const quoted = args.map((a) => `"${a.replace(/"/g, '""')}"`).join(" ");
    const cmd = `higgsfield ${quoted}`;
    const proc = spawn(cmd, [], { shell: true });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? -1, out }));
    proc.on("error", (err) => resolve({ code: -1, out: err.message }));
  });
}
function extractJson<T>(raw: string): T {
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error(`no JSON in CLI output: ${raw.slice(-200)}`);
  return JSON.parse(m[0]) as T;
}
async function higgsfieldUpload(file: string): Promise<string> {
  const r = await runHiggsfield(["upload", "create", file, "--json"]);
  if (r.code !== 0) throw new Error(`upload failed: ${r.out.slice(-200)}`);
  const p = extractJson<{ id?: string }>(r.out);
  if (!p.id) throw new Error(`upload returned no id: ${r.out.slice(-200)}`);
  return p.id;
}
function extractResultUrl(out: string): string | null {
  const urls = out.match(/https?:\/\/[^\s"',)]+\.(?:png|jpe?g|webp)/gi) || [];
  if (urls.length === 0) return null;
  return urls.find((u) => !u.includes("d2ol")) ?? urls[urls.length - 1];
}
async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ── 6 angle prompts (no environment specified) ─────────────────────────────
const ANGLE_SLOTS: Array<{ slug: string; angle: string }> = [
  { slug: "eye-level-front", angle: "Eye-level straight-on front view. The viewer is standing directly in front of the product at roughly its mounting height." },
  { slug: "low-up", angle: "Low angle looking up at the product. The viewer is lower than the fixture and the camera tilts up." },
  { slug: "high-down", angle: "High angle looking down at the product. The viewer is above the fixture and the camera tilts down toward it." },
  { slug: "three-quarter", angle: "Three-quarter angle — about 35 degrees off-axis to the right, eye-level, showing the front face plus the side profile of the product." },
  { slug: "side-profile", angle: "Direct side-profile view — 90 degrees from the front, eye-level, showing the depth and side silhouette of the product." },
  { slug: "wide-pullback", angle: "Wide pulled-back environmental view — the product is smaller in the frame, with more of the surrounding setting visible around it." },
];

function buildPrompt(angle: string): string {
  return (
    `Lifestyle photograph of this product. The product shown must match the reference image exactly — same finish, same materials, same form, same proportions, same details. This is how the product looks in person. ` +
    `Camera angle: ${angle} ` +
    `Natural composition, photorealistic, editorial photography quality. No people, no text overlays, no captions. ` +
    `The setting around the product can be whatever feels most natural for a product like this; do not anchor it to one specific room or scene.`
  );
}

async function generateOneLifestyle(
  productId: string,
  refUploadId: string,
  slug: string,
  prompt: string,
  position: number,
): Promise<{ ok: boolean; slug: string; error?: string }> {
  try {
    const inputImagesJson = JSON.stringify([{ id: refUploadId, type: "media_input" }]);
    const args = [
      "generate", "create", "nano_banana_2",
      "--prompt", prompt.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(),
      "--input_images", inputImagesJson,
      "--aspect_ratio", "1:1",
      "--resolution", "2k",
      "--wait",
    ];
    const r = await runHiggsfield(args);
    if (r.code !== 0) throw new Error(`generate exit ${r.code}: ${r.out.slice(-300)}`);
    const resultUrl = extractResultUrl(r.out);
    if (!resultUrl) throw new Error(`no result URL: ${r.out.slice(-300)}`);

    const outRes = await fetch(resultUrl);
    if (!outRes.ok) throw new Error(`download result ${outRes.status} ${resultUrl}`);
    const outBuf = Buffer.from(await outRes.arrayBuffer());

    const storagePath = `lifestyle/${productId}/from-lifestyle-${slug}.png`;
    const publicUrl = await uploadToSupabase(outBuf, storagePath);

    await prisma.productImage.create({
      data: {
        productId,
        variantId: null,
        sourceUrl: publicUrl,
        storagePath,
        fileName: `from-lifestyle-${slug}.png`,
        position,
        downloadStatus: "downloaded",
        imageType: "lifestyle",
      },
    });
    return { ok: true, slug };
  } catch (err) {
    return { ok: false, slug, error: err instanceof Error ? err.message : String(err) };
  }
}

async function processProduct(productId: string): Promise<{
  id: string;
  ok: number;
  fail: number;
  refSlug: string | null;
  errors: string[];
  ms: number;
}> {
  const t0 = Date.now();
  // 1. Find the lowest-position lifestyle ProductImage as the reference.
  const lifestyles = await prisma.productImage.findMany({
    where: { productId, imageType: "lifestyle" },
    orderBy: { position: "asc" },
  });
  if (lifestyles.length === 0) {
    return { id: productId, ok: 0, fail: 0, refSlug: null, errors: ["NO existing lifestyle to use as reference"], ms: Date.now() - t0 };
  }
  const ref = lifestyles[0];
  const refUrl = ref.storagePath ? publicSupabaseUrlFromPath(ref.storagePath) : ref.sourceUrl;
  const refLocal = path.join(REF_CACHE, `${productId}.png`);
  if (!fs.existsSync(refLocal)) await downloadTo(refUrl, refLocal);
  const refUploadId = await higgsfieldUpload(refLocal);

  // 2. Determine starting position (append at end — we wipe the old AFTER
  //    confirming new ones succeeded, so the old + new coexist briefly).
  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  const startPos = (maxPosRow._max.position ?? 0) + 1;

  // 3. Fire 6 generations in parallel against Higgsfield's API. Each
  //    `generateOneLifestyle` write its result to a unique fresh row — the
  //    existing lifestyles are NOT touched yet.
  const results = await Promise.all(
    ANGLE_SLOTS.map((s, i) =>
      generateOneLifestyle(productId, refUploadId, s.slug, buildPrompt(s.angle), startPos + i),
    ),
  );
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const errors = results.filter((r) => !r.ok).map((r) => `${r.slug}: ${r.error}`);

  // 4. ONLY wipe the old lifestyles when AT LEAST 4 new ones succeeded — that
  //    way a partial-failure (Supabase blip mid-batch) doesn't leave the
  //    product with fewer lifestyles than it started with. Threshold of 4 is
  //    "fail-safe": we accept losing 2 slots to a transient outage but won't
  //    drop a product from 6 → 1 just because of a network blip.
  if (ok >= 4) {
    const paths = lifestyles.map((l) => l.storagePath).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const { error } = await getSupabase().storage.from(BUCKET).remove(paths);
      if (error) console.warn(`  ${productId} storage rm warn: ${error.message}`);
    }
    await prisma.productImage.deleteMany({
      where: { id: { in: lifestyles.map((l) => l.id) } },
    });
  } else {
    console.warn(
      `  ${productId}: only ${ok}/6 new lifestyles succeeded — NOT wiping old ${lifestyles.length} so user keeps a working set`,
    );
  }
  return { id: productId, ok, fail, refSlug: ref.fileName ?? null, errors, ms: Date.now() - t0 };
}

function parseArgs(): { productIds: string[] } {
  const argv = process.argv.slice(2);
  let productIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--products") {
      const raw = argv[++i] ?? "";
      productIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (productIds.length === 0) {
    console.error("Usage: --products id1,id2,...");
    process.exit(1);
  }
  return { productIds };
}

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

(async () => {
  const { productIds } = parseArgs();
  fs.mkdirSync(REF_CACHE, { recursive: true });

  console.log(`=== Lifestyle-from-lifestyle for ${productIds.length} product(s) in PARALLEL ===\n`);
  const t0 = Date.now();
  const results = await Promise.all(productIds.map((id) => processProduct(id)));
  console.log(`\n=== Done in ${fmt(Date.now() - t0)} ===`);
  for (const r of results) {
    console.log(
      `  ${r.id}  ref="${r.refSlug ?? "—"}"  ok=${r.ok}/6  fail=${r.fail}  ${fmt(r.ms)}` +
        (r.errors.length > 0 ? `\n     ${r.errors.join("\n     ")}` : ""),
    );
  }
  await prisma.$disconnect();
})();
