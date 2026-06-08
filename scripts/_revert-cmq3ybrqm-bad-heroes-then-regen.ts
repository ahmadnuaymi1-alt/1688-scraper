/**
 * Revert variants #8 and #13 on cmq3ybrqm000jw25g2h0dyzbp to their 1688 source
 * images so the bulk hero script picks them up as unserved, then regenerates
 * with the hero-override notes (no acrylic display stand).
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";
const POSITIONS = [8, 13];

(async () => {
  const prisma = new PrismaClient();
  const t0 = Date.now();

  for (const pos of POSITIONS) {
    const v = await prisma.variant.findFirst({
      where: { productId: PID, position: pos },
      select: { id: true, title: true, featuredImageId: true },
    });
    if (!v) { console.error(`Variant #${pos} not found`); continue; }
    console.log(`Variant #${pos}: ${v.id} "${v.title}"`);

    const origSource = await prisma.productImage.findFirst({
      where: { productId: PID, variantId: v.id, imageType: null },
      orderBy: { position: "asc" },
      select: { id: true, storagePath: true },
    });
    if (!origSource) { console.error(`  No 1688 source found for variant #${pos}`); continue; }
    console.log(`  1688 source: ${origSource.id} (${origSource.storagePath?.slice(-50)})`);

    const currentHero = v.featuredImageId
      ? await prisma.productImage.findUnique({ where: { id: v.featuredImageId }, select: { id: true, imageType: true } })
      : null;
    console.log(`  current featured: ${v.featuredImageId} (type=${currentHero?.imageType ?? "—"})`);

    await prisma.variant.update({ where: { id: v.id }, data: { featuredImageId: origSource.id } });
    console.log("  re-pointed featuredImageId → 1688 source");

    if (currentHero && (currentHero.imageType === "hero-flat" || currentHero.imageType === "hero")) {
      const others = await prisma.variant.count({ where: { productId: PID, featuredImageId: currentHero.id } });
      if (others === 0) {
        await prisma.productImage.delete({ where: { id: currentHero.id } });
        console.log(`  deleted old hero ${currentHero.id}`);
      } else {
        console.log(`  KEPT old hero ${currentHero.id} (still pointed at by ${others} other variant(s))`);
      }
    }
  }

  await prisma.$disconnect();

  console.log(`\nRunning bulk hero script for ${PID} (will regen the now-unserved variants #8 and #13 with override notes)...`);
  const code = await new Promise<number>((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_hero-image-creator.ts", PID, "--concurrency", "2"],
      { stdio: "inherit", shell: true },
    );
    proc.on("close", (c) => resolve(c ?? -1));
    proc.on("error", () => resolve(-1));
  });

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nDone in ${elapsed}s (exit ${code})`);
})();
