/**
 * Retry hero generation for specific products / specific gallery positions,
 * with a centering-emphatic HERO_PROMPT_OVERRIDE. Used to fix heroes that
 * came back too high, too small, off-center, or with leaked supplier text.
 *
 * Targets (hard-coded from user's review-page screenshots, 2026-05-28):
 *   cmppv892200t9w2vsh5vgmgmg          → whole product (light too high)
 *   cmppqiiol00f1w2vsgq039299          → whole product (redo entirely)
 *   cmppqhueh00amw2vsdewbgxhs #19/#23/#25 → specific positions
 *   cmppqgw3z005mw2vsplzfocnl #24      → specific position
 *
 * Wipe semantics:
 *   - Whole product: delete every hero-flat / hero ProductImage row + null
 *     variant.featuredImageId pointers + best-effort Supabase delete.
 *   - Specific positions: delete the listed ProductImage row(s) and any
 *     sister rows sharing the same storagePath (sister variants that piggy-
 *     backed on the same generated hero), null their variants'
 *     featuredImageId, best-effort Supabase delete.
 *
 * After wiping, spawn _hf-cli-bulk-heroes.ts with --products <id> for each
 * product. The bulk script's idempotency check (`alreadyHasHero=N` skip on
 * the source-image group) ensures only the wiped groups get regenerated.
 *
 * Prompt override emphasises centering + scale + text-stripping:
 *   - Product geometric center must be the frame's center, not biased
 *     toward top, sides, or any edge.
 *   - Product must fill 65-75% of frame in BOTH width and height (not just
 *     "roughly 60-70%" — be assertive).
 *   - Remove every text overlay, dimension callout, Chinese character,
 *     supplier label, model code from the reference (this is what leaked
 *     into cmppqgw3z #24).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const prisma = new PrismaClient();
const supabase = (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
})();

interface Target {
  productId: string;
  positions: number[]; // empty = whole product
  note: string;
}

const TARGETS: Target[] = [
  { productId: "cmppv892200t9w2vsh5vgmgmg", positions: [], note: "whole product (light too high)" },
  { productId: "cmppqiiol00f1w2vsgq039299", positions: [], note: "whole product (redo entirely)" },
  { productId: "cmppqhueh00amw2vsdewbgxhs", positions: [19, 23, 25], note: "#19/#23/#25 too high or too small" },
  { productId: "cmppqgw3z005mw2vsplzfocnl", positions: [24], note: "#24 Chinese text + off-center" },
];

const CENTERING_PROMPT = `Professional studio product photograph. Render the product so it looks VISUALLY IDENTICAL to the reference image — every surface, finish, color, material, geometry, contour, and detail must match the reference exactly. Do not reinterpret, restyle, or alter the product appearance in any way beyond placing it on the new backdrop.
COMPOSITION — STRICT CENTERING: The product's geometric center must sit at the exact center of the frame, both horizontally and vertically. Do NOT bias the product toward the top of the frame. Do NOT bias it toward the sides. The visual centroid of the entire product (including any hanging stem, canopy, or mounting bracket) must land on the frame's midpoint cross.
COMPOSITION — STRICT SCALE: The product must fill 65–75% of the frame in BOTH its width and its height — whichever dimension is the limiting one. The product is the unmistakable subject of the photo and dominates the frame; the backdrop is generous but minimal. Do not let the product render small, thumbnail-sized, or floating in excess negative space.
Camera: 3/4 angle that reveals the most of the product (front + slight side + slight underside / top depending on mounting). Square 1:1 frame. Full-frame, 85mm equivalent, f/8 for full product sharpness.
Backdrop: Infinity cove studio backdrop, flat solid pale greige (hex #ECE6DC), gel-lit with its own dedicated lighting. All surfaces — ceiling, walls, and floor — merge into a single continuous infinite color field. No visible horizon line, no corner edge where two planes meet, no transition between ceiling and wall or wall and floor. The scene contains no architectural geometry. Near-imperceptible soft gradient, very slightly darker only in the extreme outer corners. No banding, no horizon, no visible plane transitions anywhere in the frame. No hard edges, no specular hotspots, no reflections.
Mounting surface (product-aware): Place the product on the surface its design implies:
Flush-mount / pendant / ceiling fan → ceiling (top of frame)
Sconce / wall light → wall (back of frame)
Floor lamp → floor (bottom of frame)
Table or desk lamp → tabletop (bottom of frame)
Do not invent a mounting method the product wasn't built for. The product's mounting point fades into the backdrop with only the faintest contact shadow. There must be NO visible ceiling plane, NO ceiling-to-wall corner, NO wall-to-floor corner, NO horizontal line marking where one surface ends and another begins.
Scene lighting: The product is key-lit by neutral 5500K daylight studio strobes for accurate color rendering of the fixture body, finish, and materials.
Clean-render mandate (STRICT): REMOVE every text overlay, dimension callout, dimension arrow, dimension line, measurement label (e.g. "宽度", "高度", "mm"), spec table, spec annotation, Chinese character, English character, model number, product code, supplier logo, supplier watermark, and printed label visible anywhere in the reference image. The output must contain ZERO text, ZERO numbers, ZERO callout arrows, ZERO measurement guides, ZERO supplier graphics — only the product itself sitting on the studio backdrop.
Photorealistic, sharp focus, no props, no people. Product fidelity over everything except the centering and scale rules above.
Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`;

async function wipeWholeProductHeroes(productId: string): Promise<number> {
  const heroes = await prisma.productImage.findMany({
    where: { productId, imageType: { in: ["hero", "hero-flat"] } },
    select: { id: true, storagePath: true },
  });
  if (heroes.length === 0) return 0;
  await prisma.variant.updateMany({
    where: { productId, featuredImageId: { in: heroes.map((h) => h.id) } },
    data: { featuredImageId: null },
  });
  const paths = heroes.map((h) => h.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.warn(`  storage remove warn: ${error.message}`);
  }
  const result = await prisma.productImage.deleteMany({
    where: { id: { in: heroes.map((h) => h.id) } },
  });
  return result.count;
}

async function wipeSpecificPositions(
  productId: string,
  positions: number[],
): Promise<number> {
  const targets = await prisma.productImage.findMany({
    where: { productId, position: { in: positions } },
    select: { id: true, storagePath: true, imageType: true },
  });
  if (targets.length === 0) return 0;
  // Expand to all sisters sharing the same storagePath — those are sister
  // variants that piggy-backed on the same generated hero. They must be
  // wiped together so the bulk script's group-level idempotency releases.
  const storagePaths = targets.map((t) => t.storagePath).filter((p): p is string => !!p);
  const sisters = await prisma.productImage.findMany({
    where: { productId, storagePath: { in: storagePaths } },
    select: { id: true, storagePath: true },
  });
  const wipeIds = sisters.map((s) => s.id);
  await prisma.variant.updateMany({
    where: { productId, featuredImageId: { in: wipeIds } },
    data: { featuredImageId: null },
  });
  if (storagePaths.length > 0) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove(Array.from(new Set(storagePaths)));
    if (error) console.warn(`  storage remove warn: ${error.message}`);
  }
  const result = await prisma.productImage.deleteMany({
    where: { id: { in: wipeIds } },
  });
  return result.count;
}

function spawnBulkScript(productIds: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_hf-cli-bulk-heroes.ts", "--products", productIds.join(",")],
      {
        stdio: "inherit",
        shell: true,
        env: { ...process.env, HERO_PROMPT_OVERRIDE: CENTERING_PROMPT },
      },
    );
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => {
      console.error(`spawn error: ${err.message}`);
      resolve(-1);
    });
  });
}

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

(async () => {
  const t0 = Date.now();
  console.log(`=== Hero retry (centering-emphatic) for ${TARGETS.length} target(s) ===\n`);

  for (const t of TARGETS) {
    console.log(`${t.productId} — ${t.note}`);
    if (t.positions.length === 0) {
      const n = await wipeWholeProductHeroes(t.productId);
      console.log(`  wiped ${n} hero-flat row(s)`);
    } else {
      const n = await wipeSpecificPositions(t.productId, t.positions);
      console.log(`  wiped ${n} hero-flat row(s) at position(s) ${t.positions.join(",")}`);
    }
  }

  console.log(`\nSpawning _hf-cli-bulk-heroes.ts for all 4 products with HERO_PROMPT_OVERRIDE...\n`);
  const code = await spawnBulkScript(TARGETS.map((t) => t.productId));
  console.log(`\n=== Retry done in ${fmt(Date.now() - t0)} (exit ${code}) ===`);
  await prisma.$disconnect();
})();
