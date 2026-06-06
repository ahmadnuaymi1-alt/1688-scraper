/**
 * Re-run the user's DESCRIPTION TransformationRule (category "description")
 * across a fixed set of products, fanned out in PARALLEL via Promise.all
 * (per the user's standing "bulk-ops-parallel-not-sequential" rule).
 *
 * Each product is wrapped in its own try/catch so one failure never sinks the
 * batch; a per-product before/after description length is printed plus a final
 * summary.
 *
 *   npx tsx scripts/_bulk-reapply-desc.ts
 *   npx tsx scripts/_bulk-reapply-desc.ts --products id1,id2,...
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { reapplyRules } from "../src/services/rule.service";

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

const DEFAULT_IDS = [
  "cmpy7t24u01rvw260o15bqcgs", // Black PU Leather Transparent Glass jewelry box
  "cmpy1d64b0138w2608ftg9a61", // Electroplated Alloy Arrow-Shaped Water Droplet Bolo
  "cmpy1e68i01a4w260ywsorhrn", // Polished Metal Checkered Silver Feather Pendant
  "cmpy1dm24015vw260yw1akoqd", // Electroplated Alloy Geometric Genuine Leather Cord Bolo
  "cmpy1cjzd010lw260j93m8rt9", // Alloy Turquoise Triangle Crystal Pendant Necklace
  "cmpy1bwu200zew260cg0morxa", // Leather Y-Shaped Adjustable Pendant
  "cmpy1fitq01fww260nc6esafc", // Turquoise Heart Zinc Alloy Pendant Braided Leather
  "cmpy1cnsj011qw260s8nolan7", // Antique Brass Rope Knot Pendant
  "cmpy1eze101e8w260bs8br40w", // Vintage Zinc Alloy Geometric Hand-Woven Chain
  "cmpy1g0dw01how260z2zbalt9", // Antique Bronze Crown Cat Eye Bolo Tie
];

const arg = process.argv.find((a) => a.startsWith("--products"));
const ids = arg
  ? (arg.includes("=") ? arg.split("=")[1] : process.argv[process.argv.indexOf(arg) + 1])
      .split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_IDS;

const prisma = new PrismaClient();

async function lenOf(id: string): Promise<number> {
  const p = await prisma.product.findUnique({ where: { id }, select: { descriptionHtml: true } });
  return (p?.descriptionHtml ?? "").length;
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log(`[bulk-reapply-desc] running "description" rule on ${ids.length} product(s) in PARALLEL...\n`);

  const results = await Promise.all(
    ids.map(async (id) => {
      const before = await lenOf(id).catch(() => -1);
      try {
        await reapplyRules(id, "description");
        const after = await lenOf(id).catch(() => -1);
        console.log(`  ✅ ${id}  ${before} → ${after} chars`);
        return { id, ok: true as const, before, after };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ❌ ${id}  FAILED: ${msg.slice(0, 160)}`);
        return { id, ok: false as const, error: msg };
      }
    }),
  );

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[bulk-reapply-desc] done in ${((Date.now() - start) / 1000).toFixed(1)}s — ${ok}/${ids.length} ok`);
  if (failed.length) console.log(`  failures: ${failed.map((f) => f.id).join(", ")}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
