/**
 * Variant intelligence pass for cmq489vf3000jw2dolzoxx5ks (jewelry box).
 *
 * Findings (from _inspect-cmq489vf3.ts + Gemini-Vision visual confirmation of all 6
 * featured images):
 *   - 6 visible variants, 0 hidden. Single axis "Color" with long combined strings:
 *       "Gray, 2 Velvet + 5 Clear Drawers", "Beige, 5 Velvet + 2 Solid Drawers", etc.
 *   - Names are ACCURATE (each image matches its label) — no opaque codes, no Vision
 *     rename needed.
 *   - The 6 rows are a clean 2-axis matrix: Color (Gray, Beige) × Configuration
 *     (2 Velvet + 5 Clear / 5 Velvet + 2 Clear / 5 Velvet + 2 Solid) = 2 × 3 = 6, complete.
 *   - productType is null.
 *
 * Decision (anchor: "easiest for the customer to understand"): SPLIT into two axes
 *   Color × Drawer Configuration. No dedup (all 6 distinct), no hides, no pack-axis
 *   false-positive to unhide. Set productType = "jewelry-box".
 *
 * Sequential DB writes (connection_limit=1).
 */
import fs from "node:fs";
import path from "node:path";
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

const PID = "cmq489vf3000jw2dolzoxx5ks";

/** Parse "Gray, 2 Velvet + 5 Clear Drawers" → { color, config }. */
function parseCombined(s: string): { color: string; config: string } {
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { color: s.trim(), config: "" };
  const color = s.slice(0, commaIdx).trim();
  let config = s.slice(commaIdx + 1).trim();
  // Normalize config to a clean customer-facing label, ensure trailing "Drawers".
  config = config.replace(/\s+/g, " ").trim();
  if (!/drawers?$/i.test(config)) config = `${config} Drawers`;
  // Title-case the words but keep "+" and digits intact.
  config = config.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  return { color, config };
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const variants = await prisma.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { id: true, position: true, title: true, option1: true, option2: true, isHidden: true },
    });
    console.log(`Loaded ${variants.length} variants`);

    // Build axis values
    const parsed = variants.map((v) => {
      const { color, config } = parseCombined(v.option1 ?? v.title ?? "");
      return { v, color, config };
    });

    const colors = [...new Set(parsed.map((p) => p.color))];
    const configs = [...new Set(parsed.map((p) => p.config))];
    console.log("Color axis values:", colors.join(" | "));
    console.log("Configuration axis values:", configs.join(" | "));

    // Sanity: confirm clean matrix (no parse failures)
    const bad = parsed.filter((p) => !p.color || !p.config);
    if (bad.length) {
      console.error("PARSE FAILURES — aborting:", bad.map((b) => b.v.title));
      process.exit(1);
    }

    // 1) Product: productType + optionNames (2-axis)
    await prisma.product.update({
      where: { id: PID },
      data: {
        productType: "jewelry-box",
        optionNames: JSON.stringify(["Color", "Drawer Configuration"]),
      },
    });
    console.log('\nProduct updated: productType="jewelry-box", optionNames=["Color","Drawer Configuration"]');

    // 2) Per-variant: option1=Color, option2=Config, title="{Color} / {Config}"
    //    All 6 distinct → no hides. Sequential writes.
    console.log("\nApplying per-variant axis split (sequential):");
    for (const p of parsed) {
      const title = `${p.color} / ${p.config}`;
      await prisma.variant.update({
        where: { id: p.v.id },
        data: { option1: p.color, option2: p.config, option3: null, title, isHidden: false },
      });
      console.log(`  #${String(p.v.position).padStart(2)} show  o1="${p.color}"  o2="${p.config}"  title="${title}"`);
    }

    // Verify
    const after = await prisma.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { position: true, title: true, option1: true, option2: true, isHidden: true },
    });
    const visible = after.filter((v) => !v.isHidden);
    console.log(`\nFinal: ${visible.length} visible / ${after.length} total`);
    for (const v of after) {
      console.log(`  #${String(v.position).padStart(2)} ${v.isHidden ? "HIDE" : "show"}  ${v.option1} | ${v.option2}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})();
