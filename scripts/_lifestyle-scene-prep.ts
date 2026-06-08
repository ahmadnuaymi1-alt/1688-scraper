/**
 * Lifestyle Scene Prep — read-only helper for the Claude-authored scene flow.
 *
 * Given a product URL or id, downloads the product's gallery + per-variant
 * reference images to a local folder and writes a context file, so Claude can
 * view the actual product and author six lifestyle scene prompts. Writes
 * nothing to the database and nothing to Supabase.
 *
 * Output, under `scene-overrides/_prep/<productId>/`:
 *   gallery/                every scraped source image, for Claude to view
 *   variants/               one reference image per scene slot (slot1..slot6)
 *   context.md              title, description, specs, variants + slot table
 *   override.template.json  6-slot skeleton to fill in
 *
 * Next step: Claude views the images + context.md, classifies the product
 * (indoor / outdoor / both), designs six scenes, and writes
 * `scene-overrides/<productId>.json`. The user then runs the existing
 * `scripts/_lifestyle-image-creator.ts <productId>`, which picks up that
 * override instead of the curated-library match.
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-scene-prep.ts <productIdOrUrl>
 *
 * Auto-loads .env.local.
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

// ─────────────────────────────────────────────────────────────────────────────
// Env loader (copied from _lifestyle-image-creator.ts — keeps that file untouched)
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const COUNT = 6;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const PREP_ROOT = path.resolve(process.cwd(), "scene-overrides", "_prep");

let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase (copied from _lifestyle-image-creator.ts)
// ─────────────────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicSupabaseUrlFromPath(storagePath: string): string {
  const supabase = getSupabase();
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function detectProductId(input: string): string {
  const reviewMatch = input.match(/\/review\/([A-Za-z0-9_-]+)/);
  if (reviewMatch) return reviewMatch[1];
  if (/^c[a-z0-9]{24,}$/.test(input)) return input;
  console.error(
    `Could not detect productId from "${input}". Expected a cuid or /review/<id> URL.`,
  );
  process.exit(1);
}

function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
}

/** Download an image and normalise it to a bounded JPEG so the Read tool can
 *  render it quickly. Returns the written path, or null on failure. */
async function downloadImage(
  url: string,
  destNoExt: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! download ${res.status} — ${url.slice(0, 70)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = `${destNoExt}.jpg`;
    // Cap at 1024px → max ~1.05 MP, safely under the Claude vision API's
    // ~1.15-megapixel limit so the images always render (a larger cap such as
    // 1536px = 2.36 MP gets rejected, especially in multi-image requests).
    await sharp(buf)
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(dest);
    return dest;
  } catch (e) {
    console.warn(
      `  ! image failed — ${url.slice(0, 70)}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/** Crude HTML → text for the scraped description. */
function htmlToText(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Render the productContext JSON blob compactly (capped). */
function renderProductContext(raw: string | null): string {
  if (!raw) return "_(none)_";
  try {
    const parsed = JSON.parse(raw);
    const text = JSON.stringify(parsed, null, 2);
    return text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text;
  } catch {
    return raw.length > 2000 ? `${raw.slice(0, 2000)}… (truncated)` : raw;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npx tsx scripts/_lifestyle-scene-prep.ts <productIdOrUrl>");
    process.exit(1);
  }
  const productId = detectProductId(input);
  const prisma = getPrisma();

  // Fetch the product, retrying transient pgbouncer connection blips (the same
  // failure mode _lifestyle-image-creator.ts guards against).
  let product: Awaited<ReturnType<typeof fetchProduct>> = null;
  async function fetchProduct() {
    return prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
        images: true,
      },
    });
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      product = await fetchProduct();
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 6) {
        console.error(`DB fetch failed after 6 attempts: ${msg}`);
        process.exit(1);
      }
      console.warn(`  DB connection attempt ${attempt}/6 failed (transient) — retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!product) {
    console.error(`Product ${productId} not found`);
    process.exit(1);
  }

  console.log(`Lifestyle Scene Prep — ${product.title.slice(0, 70)}`);

  const outDir = path.join(PREP_ROOT, productId);
  const galleryDir = path.join(outDir, "gallery");
  const variantsDir = path.join(outDir, "variants");
  fs.mkdirSync(galleryDir, { recursive: true });
  fs.mkdirSync(variantsDir, { recursive: true });

  // ── Hero pool + 6 slots — mirrors _lifestyle-image-creator.ts so the slot
  //    table here matches the variant the creator will pair with each scene.
  const imagesById = new Map(product.images.map((img) => [img.id, img]));
  const seenPaths = new Set<string>();
  const heroPool: Array<{
    variantPosition: number;
    variantTitle: string;
    url: string;
  }> = [];
  for (const v of product.variants) {
    const img =
      (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined) ??
      product.images.find((pi) => pi.variantId === v.id) ??
      product.images[0];
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    heroPool.push({
      variantPosition: v.position,
      variantTitle: v.title,
      url: img.storagePath
        ? publicSupabaseUrlFromPath(img.storagePath)
        : img.sourceUrl,
    });
  }
  if (heroPool.length === 0) {
    console.error("No reference image found for any visible variant on this product.");
    process.exit(1);
  }
  const slots = Array.from({ length: COUNT }).map((_, i) => {
    const ref = heroPool[i % heroPool.length];
    return {
      slot: i + 1,
      variantPosition: ref.variantPosition,
      variantTitle: ref.variantTitle,
      url: ref.url,
    };
  });

  // ── Download the gallery (scraped source images) ───────────────────────
  const sourceImages = product.images
    .filter((img) => img.imageType === "source" || img.imageType == null)
    .sort((a, b) => a.position - b.position);
  console.log(`Downloading ${sourceImages.length} gallery image(s) → gallery/`);
  const galleryFiles: string[] = [];
  for (let i = 0; i < sourceImages.length; i++) {
    const img = sourceImages[i];
    const url = img.storagePath
      ? publicSupabaseUrlFromPath(img.storagePath)
      : img.sourceUrl;
    const nn = String(i + 1).padStart(2, "0");
    const written = await downloadImage(
      url,
      path.join(galleryDir, `${nn}_${safeSlug(img.fileName ?? img.id)}`),
    );
    if (written) galleryFiles.push(`gallery/${path.basename(written)}`);
  }

  // ── Download the 6 slot reference images ───────────────────────────────
  console.log(`Downloading ${slots.length} variant reference image(s) → variants/`);
  const slotFiles: Array<{ slot: number; file: string | null }> = [];
  for (const s of slots) {
    const written = await downloadImage(
      s.url,
      path.join(variantsDir, `slot${s.slot}_${safeSlug(s.variantTitle)}`),
    );
    slotFiles.push({ slot: s.slot, file: written ? `variants/${path.basename(written)}` : null });
  }

  // ── context.md ─────────────────────────────────────────────────────────
  const slotTable = slots
    .map((s) => {
      const f = slotFiles.find((x) => x.slot === s.slot)?.file ?? "(download failed)";
      return `| ${s.slot} | ${s.variantPosition} | ${s.variantTitle} | ${f} |`;
    })
    .join("\n");

  const variantTable = product.variants
    .map((v) => {
      const opts = [v.option1, v.option2, v.option3].map((o) => o ?? "—").join(" | ");
      const labels = [v.supplierLabel1, v.supplierLabel2, v.supplierLabel3]
        .filter(Boolean)
        .join(" / ");
      return `| ${v.position} | ${v.title} | ${opts} | ${labels || "—"} |`;
    })
    .join("\n");

  const context = `# Scene Prep — ${product.title}

- **Product ID:** \`${productId}\`
- **Product type:** ${product.productType ?? "—"}
- **Option axes:** ${product.optionNames ?? "—"}
- **Visible variants:** ${product.variants.length}
- **Gallery images:** ${galleryFiles.length}

## Slot → variant map

Each of the 6 scenes is paired with the variant in its slot. Design scene N
for the variant shown in \`variants/slotN_*.jpg\`.

| Slot | Variant position | Variant title | Reference image |
|------|------------------|---------------|-----------------|
${slotTable}

## Variants

| Pos | Title | Option 1 \\| 2 \\| 3 | Supplier labels |
|-----|-------|---------------------|-----------------|
${variantTable}

## Description

${htmlToText(product.descriptionHtml) || "_(none)_"}

## Product context / specs

\`\`\`json
${renderProductContext(product.productContext)}
\`\`\`

## Gallery images

View every file in \`gallery/\` to understand the product and **where it is
actually used** — interior, exterior, or both. Watch for variant differences.

${galleryFiles.map((f) => `- ${f}`).join("\n") || "_(none downloaded)_"}

---

**Next step:** view the images above, classify the product (indoor / outdoor /
both), then author \`scene-overrides/${productId}.json\` — use
\`override.template.json\` (in this folder) as the skeleton. Then run:

\`\`\`
npx tsx scripts/_lifestyle-image-creator.ts ${productId}
\`\`\`
`;
  fs.writeFileSync(path.join(outDir, "context.md"), context);

  // ── override.template.json ─────────────────────────────────────────────
  const template = {
    productId,
    productTitle: product.title,
    authoredBy: "claude-code",
    authoredAt: "",
    category: "",
    scenes: slots.map((s) => ({
      slug: "",
      mode: "minimalist",
      prompt: "",
      variantSlot: s.slot,
    })),
  };
  fs.writeFileSync(
    path.join(outDir, "override.template.json"),
    JSON.stringify(template, null, 2),
  );

  console.log("");
  console.log(`Prep complete → ${path.relative(process.cwd(), outDir)}`);
  console.log(`  gallery/   ${galleryFiles.length} image(s)`);
  console.log(`  variants/  ${slotFiles.filter((s) => s.file).length}/${COUNT} reference image(s)`);
  console.log(`  context.md, override.template.json`);
  console.log("");
  console.log(`Next: view the images, then write scene-overrides/${productId}.json`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  try {
    await getPrisma().$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
