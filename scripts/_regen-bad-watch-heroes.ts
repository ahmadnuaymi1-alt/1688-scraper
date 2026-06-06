/**
 * For the 4 user-flagged bad watch heroes (positions #28, #29, #31, #36),
 * delete the hero-flat ProductImage rows + re-point each affected variant's
 * featuredImageId to its ORIGINAL 1688 source image, then run the bulk hero
 * script. The script's idempotency check sees the affected variants as
 * un-served and regenerates them using the now-TIGHTENED HERO_PROMPT_WATCH
 * (which forbids flat-lay / cushion / watch-roll and locks the standing 3/4
 * angle).
 *
 * The 12 remaining good heroes are left untouched — their variants still
 * have the original featuredImageId pointing at their existing hero, so the
 * idempotency check skips them.
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
const BAD = [
  { heroId: "cmpznig46000tw2mwcd0uw8gy", variantId: "cmpzifo4t003yw2hs2jzeykt8", origSourceId: "cmpzifswk004uw2hsdag5y3pq", label: "pos28 Silver / Blue Dial" },
  { heroId: "cmpzngzel000dw2mw97z9lg3g", variantId: "cmpzifo4t0040w2hsasgq079d", origSourceId: "cmpzifv94005cw2hsl5pzevqu", label: "pos29 Silver / Green Bezel" },
  { heroId: "cmpznha44000fw2mwgafd8m51", variantId: "cmpzifo4t0044w2hsc2kpzm2r", origSourceId: "cmpzifvnb005kw2hstbk20868", label: "pos31 Silver / Light Blue Dial" },
  { heroId: "cmpzniihx000vw2mwy1h2k8rf", variantId: "cmpzifo4t004aw2hs76mlax8d", origSourceId: "cmpzifwq8005sw2hszjxtetj0", label: "pos36 Two-Tone Gold and Silver / Blue Dial" },
];

(async () => {
  const prisma = new PrismaClient();
  const t0 = Date.now();

  console.log(`Re-pointing ${BAD.length} variants to their 1688 sources + deleting bad heroes...`);
  for (const b of BAD) {
    await prisma.variant.update({
      where: { id: b.variantId },
      data: { featuredImageId: b.origSourceId },
    });
    await prisma.productImage.delete({ where: { id: b.heroId } });
    console.log(`  ${b.label}: variant re-pointed to ${b.origSourceId.slice(0, 12)}…, hero ${b.heroId.slice(0, 12)}… deleted`);
  }
  await prisma.$disconnect();

  console.log(`\nRunning bulk hero script for ${PID} (regenerates only the ${BAD.length} unserved variants)...`);
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
