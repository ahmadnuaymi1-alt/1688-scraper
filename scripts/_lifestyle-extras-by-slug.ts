/**
 * Generate ONLY the scene slugs you name from a product's scene-overrides JSON,
 * without re-running the 6 already-attached ones. Used when adding more
 * lifestyles to an existing batch — the standard _lifestyle-image-creator.ts
 * regenerates the whole override set (clamped 6-8); this one targets exactly
 * the slugs you pass.
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-extras-by-slug.ts <productId> <slug1,slug2,slug3>
 *
 * The slugs must match entries in scene-overrides/<productId>.json. Each
 * scene's `variantSlot` decides which hero pool entry is used as the
 * reference. Result PNGs are uploaded to Supabase and attached as
 * ProductImage rows with imageType="lifestyle", variantId=null — exactly
 * the same shape as the main lifestyle script.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { runHiggsfieldCliBatch } from "./_higgsfield-cli";

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

async function main(): Promise<void> {
  const [productId, slugCsv] = process.argv.slice(2);
  if (!productId || !slugCsv) {
    console.error("Usage: <productId> <slug1,slug2,...>");
    process.exit(1);
  }
  const wantSlugs = new Set(slugCsv.split(",").map((s) => s.trim()).filter(Boolean));

  const ovPath = path.resolve(process.cwd(), "scene-overrides", `${productId}.json`);
  if (!fs.existsSync(ovPath)) {
    console.error(`No scene-overrides JSON at ${ovPath}`);
    process.exit(1);
  }
  const override = JSON.parse(fs.readFileSync(ovPath, "utf-8")) as {
    scenes: Array<{ slug: string; prompt: string; variantSlot: number }>;
  };
  const scenes = override.scenes.filter((s) => wantSlugs.has(s.slug));
  if (scenes.length === 0) {
    console.error(`None of the requested slugs found in JSON. Requested: ${[...wantSlugs].join(", ")}`);
    process.exit(1);
  }
  console.log(`Generating ${scenes.length} scene(s) for ${productId}:`);
  for (const s of scenes) console.log(`  - ${s.slug} (variantSlot=${s.variantSlot})`);

  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, variants: { where: { isHidden: false }, select: { id: true, featuredImageId: true, title: true }, orderBy: { position: "asc" } } },
  });
  if (!product) { console.error(`product ${productId} not found`); process.exit(1); }

  // Build the hero pool: unique featuredImage storagePaths in variant order.
  const variantsWithFeat = product.variants.filter((v) => v.featuredImageId);
  const featIds = [...new Set(variantsWithFeat.map((v) => v.featuredImageId!))];
  const featRows = await prisma.productImage.findMany({
    where: { id: { in: featIds } },
    select: { id: true, storagePath: true, sourceUrl: true },
  });
  const seenPaths = new Set<string>();
  const heroPool: Array<{ imageId: string; storagePath: string; sourceUrl: string }> = [];
  for (const v of variantsWithFeat) {
    const img = featRows.find((r) => r.id === v.featuredImageId);
    if (!img || !img.storagePath) continue;
    if (seenPaths.has(img.storagePath)) continue;
    seenPaths.add(img.storagePath);
    heroPool.push({ imageId: img.id, storagePath: img.storagePath, sourceUrl: img.sourceUrl });
  }
  if (heroPool.length === 0) { console.error("hero pool is empty — generate heroes first"); process.exit(1); }
  console.log(`Hero pool: ${heroPool.length} entries`);

  // Download each pool reference to a temp file (the CLI wrapper needs file paths).
  const tmpDir = path.join(require("node:os").tmpdir(), "lifestyle-extras", productId);
  fs.mkdirSync(tmpDir, { recursive: true });
  const refPaths = await Promise.all(heroPool.map(async (h, i) => {
    const local = path.join(tmpDir, `pool_${i}.png`);
    const resp = await fetch(h.sourceUrl);
    if (!resp.ok) throw new Error(`fetch ${h.sourceUrl}: ${resp.status}`);
    fs.writeFileSync(local, Buffer.from(await resp.arrayBuffer()));
    return local;
  }));

  // Build batch prompts. variantSlot is 1-indexed; if out of range, wrap.
  const prompts = scenes.map((s, i) => {
    const idx = ((s.variantSlot - 1) % heroPool.length + heroPool.length) % heroPool.length;
    return {
      slug: `v2_lifestyle_${i + 7}_${s.slug.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      text: s.prompt,
      referenceImage: [refPaths[idx]],
    };
  });

  const outDir = path.join(require("node:os").tmpdir(), "lifestyle-extras", "out", productId);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\nFiring ${prompts.length} Higgsfield job(s)...`);
  const { ok, fail } = await runHiggsfieldCliBatch({ prompts, outDir, concurrency: prompts.length });
  console.log(`Generation done. ${ok}/${prompts.length} succeeded, ${fail} failed.`);

  // Attach successes to the DB.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let nextPos = ((await prisma.productImage.aggregate({ where: { productId }, _max: { position: true } }))._max.position ?? 0) + 1;
  let attached = 0;
  for (const p of prompts) {
    const outPath = path.join(outDir, `${p.slug}.png`);
    if (!fs.existsSync(outPath)) { console.log(`  ${p.slug} → no output file, skipping`); continue; }
    const buf = fs.readFileSync(outPath);
    const storagePath = `lifestyle/${productId}/${p.slug}.png`;
    const up = await supabase.storage.from(BUCKET).upload(storagePath, buf, { contentType: "image/png", upsert: true });
    if (up.error) { console.log(`  ${p.slug} → supabase upload FAIL: ${up.error.message}`); continue; }
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
    await prisma.productImage.create({
      data: {
        productId,
        variantId: null,
        sourceUrl: publicUrl,
        storagePath,
        fileName: `${p.slug}.png`,
        position: nextPos++,
        downloadStatus: "downloaded",
        imageType: "lifestyle",
      },
    });
    console.log(`  ${p.slug} → uploaded + attached`);
    attached++;
  }

  console.log(`\nAttached ${attached}/${prompts.length} lifestyles.`);
  console.log(`Review: http://localhost:3000/review/${productId}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
