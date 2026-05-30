/**
 * ONE-OFF: regenerate heroes for cmpjstyid007tw2ggulv0g8b3 with the fixture's
 * bulb switched OFF (product rendered as in the variant reference images,
 * studio backdrop unchanged). Single-product script, intentionally hardcoded.
 *
 *   1. Wipe existing hero-flat ProductImage rows + best-effort Supabase delete.
 *   2. Clear variant.featuredImageId pointers that reference the wiped rows.
 *   3. Spawn _hf-cli-bulk-heroes.ts with --products <id> and a lights-OFF
 *      HERO_PROMPT_OVERRIDE in the environment.
 *
 * The canonical HERO_PROMPT in src/lib/hero/prompt.ts is NOT touched.
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

const PRODUCT_ID = "cmpjstyid007tw2ggulv0g8b3";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const LIGHTS_OFF_PROMPT = `Professional studio product photograph. Render the product so it looks VISUALLY IDENTICAL to the reference image — every surface, finish, color, material, geometry, contour, and detail must match the reference exactly. Do not reinterpret, restyle, or alter the product appearance in any way beyond placing it on the new backdrop.
The product is centered in frame both vertically and horizontally, shown at a 3/4 angle that reveals the most of the product.
Backdrop: Infinity cove studio backdrop, flat solid pale greige (hex #ECE6DC), gel-lit with its own dedicated lighting. All surfaces — ceiling, walls, and floor — merge into a single continuous infinite color field. No visible horizon line, no corner edge where two planes meet, no transition between ceiling and wall or wall and floor. The scene contains no architectural geometry. Near-imperceptible soft gradient, very slightly darker only in the extreme outer corners. No banding, no horizon, no visible plane transitions anywhere in the frame. No hard edges, no specular hotspots, no reflections. The backdrop is purely a color field.
Mounting surface (product-aware): Place the product on the surface its design implies:
Flush-mount / pendant → ceiling (top of frame)
Sconce / wall light → wall (back of frame)
Floor lamp → floor (bottom of frame)
Table or desk lamp → tabletop (bottom of frame)
Do not invent a mounting method the product wasn't built for. The product's mounting point fades into the backdrop with only the faintest contact shadow. There must be NO visible ceiling plane, NO ceiling-to-wall corner, NO wall-to-floor corner, NO horizontal line marking where one surface ends and another begins.
Scene lighting: The product is key-lit by neutral 5500K daylight studio strobes for accurate color rendering of the fixture body, finish, and materials.
Composition: Square 1:1 frame. Product occupies roughly 60–70% of the frame, perfectly centered horizontally and vertically, with generous negative space above. Camera: full-frame, 85mm equivalent, f/8 for full product sharpness, shallow depth on the background only. Clean, minimal, color-neutral product catalog aesthetic. Photorealistic, sharp focus, no props, no people.
Clean-render mandate (STRICT): REMOVE every text overlay, dimension callout, dimension arrow, dimension line, measurement label (e.g. "宽度", "高度", "mm"), spec table, spec annotation, Chinese character, English character, model number, product code, supplier logo, supplier watermark, and printed label visible anywhere in the reference image. The output must contain ZERO text, ZERO numbers, ZERO callout arrows, ZERO measurement guides, and ZERO supplier graphics — only the product itself sitting on the studio backdrop. The product must remain visually identical to the reference in every other respect.
Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`;

async function wipeExistingHeroes() {
  const prisma = new PrismaClient();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existing = await prisma.productImage.findMany({
    where: {
      productId: PRODUCT_ID,
      imageType: { in: ["hero", "hero-flat"] },
    },
    select: { id: true, storagePath: true },
  });
  console.log(`Found ${existing.length} existing hero/hero-flat rows for ${PRODUCT_ID}`);
  if (existing.length === 0) {
    await prisma.$disconnect();
    return;
  }

  // 1. Null variant.featuredImageId pointers at the wiped rows.
  const wipedIds = existing.map((e) => e.id);
  const unlinked = await prisma.variant.updateMany({
    where: { productId: PRODUCT_ID, featuredImageId: { in: wipedIds } },
    data: { featuredImageId: null },
  });
  console.log(`Unlinked ${unlinked.count} variant.featuredImageId pointer(s)`);

  // 2. Best-effort storage delete.
  const paths = existing.map((e) => e.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) {
      console.warn(`Storage delete failed (non-fatal): ${error.message}`);
    } else {
      console.log(`Deleted ${paths.length} object(s) from Supabase storage`);
    }
  }

  // 3. DB delete.
  const result = await prisma.productImage.deleteMany({
    where: { id: { in: wipedIds } },
  });
  console.log(`Deleted ${result.count} ProductImage row(s)`);
  await prisma.$disconnect();
}

async function spawnBulkScript(): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_hf-cli-bulk-heroes.ts", "--products", PRODUCT_ID],
      {
        stdio: "inherit",
        shell: true,
        env: { ...process.env, HERO_PROMPT_OVERRIDE: LIGHTS_OFF_PROMPT },
      },
    );
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => {
      console.error(`spawn error: ${err.message}`);
      resolve(-1);
    });
  });
}

(async () => {
  const t0 = Date.now();
  console.log(`=== ONE-OFF lights-OFF heroes for ${PRODUCT_ID} ===\n`);
  console.log(`Step 1: wipe existing hero/hero-flat rows\n`);
  await wipeExistingHeroes();
  console.log(`\nStep 2: spawn _hf-cli-bulk-heroes.ts with HERO_PROMPT_OVERRIDE\n`);
  const code = await spawnBulkScript();
  const totalSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== one-off complete in ${totalSec}s (exit ${code}) ===`);
})();
