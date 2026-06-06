/**
 * Re-do hero images for the Steel Green and Steel Black variants of
 * product cmpzie4gt0011w2hsztxiyvqz. The user has already re-pointed each
 * variant's featuredImageId back to its 1688 supplier source, so I just
 * need to clean up any orphan / still-attached hero ProductImage rows for
 * those two variants, then run the bulk hero script.
 *
 * Same pattern as _regen-bad-watch-heroes-v2.ts but for product B's two
 * specific variants. No per-product override needed here — the standard
 * HERO_PROMPT_WATCH should work; the prior bad output was the model
 * struggling with the chunky chronograph reference, not a flat-lay issue.
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

const PID = "cmpzie4gt0011w2hsztxiyvqz";

(async () => {
  const prisma = new PrismaClient();
  const t0 = Date.now();

  // The user said Steel Green and Steel Black — find them by title fragment.
  // Variant titles are still in Chinese (钢色绿面 = steel-green-dial, 钢色黑面 = steel-black-dial),
  // so match on those Chinese fragments.
  const variants = await prisma.variant.findMany({
    where: {
      productId: PID,
      isHidden: false,
      OR: [
        { title: { contains: "绿" } }, // green
        { title: { contains: "黑" } }, // black
      ],
    },
    select: { id: true, title: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  if (variants.length === 0) {
    console.error("No Steel Green / Steel Black variants found.");
    process.exit(1);
  }
  console.log(`Found ${variants.length} variant(s) to re-do:`);
  for (const v of variants) console.log(`  ${v.id}  ${v.title}  feat=${v.featuredImageId}`);

  // For each variant: verify featuredImageId currently points to a 1688 source
  // (imageType=null). If yes, find any leftover hero-flat rows for this variant
  // (with variantId pointing at this variant OR via featuredImageId backref)
  // and delete them so the bulk script sees the variant as un-served.
  for (const v of variants) {
    const featImg = v.featuredImageId
      ? await prisma.productImage.findUnique({ where: { id: v.featuredImageId }, select: { id: true, imageType: true, storagePath: true } })
      : null;
    console.log(`  ${v.title} → current featured imageType=${featImg?.imageType ?? "—"} storage=${featImg?.storagePath?.slice(-50)}`);

    // Delete any orphan hero-flat rows associated with this variant.
    // Two ways a hero could still associate:
    //   (a) ProductImage row with variantId = this variant + imageType=hero-flat
    //   (b) The variant's CURRENT featuredImageId IS a hero-flat (shouldn't be, since user re-pointed, but defensive check)
    const orphanHeroes = await prisma.productImage.findMany({
      where: {
        productId: PID,
        variantId: v.id,
        imageType: { in: ["hero", "hero-flat"] },
      },
      select: { id: true, storagePath: true },
    });
    for (const h of orphanHeroes) {
      // Only delete if no OTHER variant still has it as featuredImageId.
      const others = await prisma.variant.count({ where: { productId: PID, featuredImageId: h.id } });
      if (others === 0) {
        await prisma.productImage.delete({ where: { id: h.id } });
        console.log(`    deleted orphan hero ${h.id} (${h.storagePath?.slice(-50)})`);
      }
    }
    if (featImg && (featImg.imageType === "hero" || featImg.imageType === "hero-flat")) {
      console.log(`    NOTE: variant.featuredImageId still points at a hero-flat row — re-pointing to 1688 source...`);
      const orig1688 = await prisma.productImage.findFirst({
        where: { productId: PID, variantId: v.id, imageType: null },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      if (orig1688) {
        await prisma.variant.update({ where: { id: v.id }, data: { featuredImageId: orig1688.id } });
        console.log(`    re-pointed to ${orig1688.id}`);
      } else {
        console.log(`    WARN: no 1688 source found for this variant`);
      }
    }
  }
  await prisma.$disconnect();

  console.log(`\nRunning bulk hero script for ${PID} (regenerates the ${variants.length} unserved variants)...`);
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
