/**
 * Re-do the 4 user-flagged bad heroes by looking up each variant's CURRENT
 * featuredImageId at runtime (so we don't depend on stale hardcoded hero IDs
 * after intervening regenerations). For each affected variant:
 *   1. Find its current featuredImage (the latest hero-flat row).
 *   2. Find the original 1688 source ProductImage (imageType IS NULL, same
 *      variantId, lowest position).
 *   3. Re-point Variant.featuredImageId to the 1688 source.
 *   4. Delete the current hero row.
 *   5. Run the bulk hero script — the affected variants now look "un-served"
 *      and get regenerated using HERO_PROMPT_WATCH + the per-product
 *      heroPromptExtraNotes from hero-overrides/<productId>.json.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";

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

const PID = "cmpzifo4s003uw2hsxm35vqyf";
const VARIANT_IDS = [
  "cmpzifo4t003yw2hs2jzeykt8", // Silver / Blue Dial
  "cmpzifo4t0040w2hsasgq079d", // Silver / Green Bezel
  "cmpzifo4t0044w2hsc2kpzm2r", // Silver / Light Blue Dial
  "cmpzifo4t004aw2hs76mlax8d", // Two-Tone Gold and Silver / Blue Dial
];

(async () => {
  const prisma = new PrismaClient();
  const t0 = Date.now();

  for (const vid of VARIANT_IDS) {
    const v = await prisma.variant.findUnique({ where: { id: vid }, select: { id: true, title: true, featuredImageId: true } });
    if (!v) { console.log(`  variant ${vid}: NOT FOUND`); continue; }
    const origSource = await prisma.productImage.findFirst({
      where: { productId: PID, variantId: vid, imageType: null },
      orderBy: { position: "asc" },
      select: { id: true, storagePath: true },
    });
    if (!origSource) { console.log(`  variant ${vid} (${v.title}): no 1688 source found — skipping`); continue; }

    const currentHero = v.featuredImageId
      ? await prisma.productImage.findUnique({ where: { id: v.featuredImageId }, select: { id: true, imageType: true } })
      : null;

    console.log(`  ${v.title}:`);
    console.log(`    current featured: ${v.featuredImageId} (type=${currentHero?.imageType ?? "—"})`);
    console.log(`    re-pointing to 1688 source: ${origSource.id} (${origSource.storagePath?.slice(-50)})`);

    await prisma.variant.update({
      where: { id: vid },
      data: { featuredImageId: origSource.id },
    });

    if (currentHero && (currentHero.imageType === "hero-flat" || currentHero.imageType === "hero")) {
      // Only delete if no other variant still points at this hero.
      const others = await prisma.variant.count({
        where: { productId: PID, featuredImageId: currentHero.id },
      });
      if (others === 0) {
        await prisma.productImage.delete({ where: { id: currentHero.id } });
        console.log(`    deleted old hero ${currentHero.id}`);
      } else {
        console.log(`    KEPT old hero ${currentHero.id} (still pointed at by ${others} other variant(s))`);
      }
    }
  }
  await prisma.$disconnect();

  console.log(`\nRunning bulk hero script for ${PID} (regenerates the ${VARIANT_IDS.length} unserved variants with hero-override notes)...`);
  const code = await new Promise<number>((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_hf-cli-bulk-heroes.ts", "--products", PID, "--concurrency", "4"],
      { stdio: "inherit", shell: true },
    );
    proc.on("close", (c) => resolve(c ?? -1));
    proc.on("error", () => resolve(-1));
  });

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nDone in ${elapsed}s = ${Math.floor(elapsed / 60)}m ${elapsed % 60}s (exit ${code})`);
})();
