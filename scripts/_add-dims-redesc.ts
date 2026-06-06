/**
 * Add per-size OVERALL dimensions (inches) to each jewellery-box child's
 * productContext, re-run the description rule so the dimensions appear, then
 * verify — and if the lean rule still omits them, inject a Dimensions block
 * directly into descriptionHtml as a fallback.
 *
 * Dimensions sourced from the 1688 listing spec cards (5 confirmed, 7-Layer
 * estimated from the large-capacity line). Inches per the user's standing
 * "inches not cm" preference.
 *
 *   npx tsx scripts/_add-dims-redesc.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// overall L x W x H in inches; cm kept for the context note; confirmed unless est.
const DIMS: Record<string, { label: string; inch: string; cm: string; est: boolean }> = {
  cmpxx12260001w2yspsqfr94i: { label: "2-Layer", inch: "14.1 x 7.9 x 5.1 in", cm: "35.7 x 20 x 13 cm", est: false },
  cmpxx130y000hw2ys0d5ikvsb: { label: "4-Layer", inch: "11.0 x 7.5 x 7.9 in", cm: "28 x 19 x 20 cm", est: false },
  cmpxx161q001pw2ysta9lvk0k: { label: "5-Layer", inch: "11.0 x 7.5 x 9.4 in", cm: "28 x 19 x 24 cm", est: false },
  cmpxx1854002lw2ys7vdeln6v: { label: "6-Layer", inch: "12.4 x 8.1 x 9.6 in", cm: "31.5 x 20.5 x 24.5 cm", est: false },
  cmpxx19xo003dw2ysoykzsyhg: { label: "7-Layer", inch: "12.6 x 9.4 x 14.2 in", cm: "~32 x 24 x 36 cm", est: true },
  cmpxx1auc003tw2ysfupa6ih9: { label: "10-Layer", inch: "12.6 x 9.4 x 18.7 in", cm: "32 x 24 x 47.5 cm", est: false },
};

(async () => {
  const { reapplyRules } = await import("../src/services/rule.service");

  // ── 1. append dims to productContext (sequential) ──
  for (const [cid, d] of Object.entries(DIMS)) {
    const p = await prisma.product.findUnique({ where: { id: cid }, select: { productContext: true } });
    if (!p) continue;
    const base = (p.productContext ?? "").replace(/\s*OVERALL DIMENSIONS.*$/s, "").trim();
    const note =
      `\n\nOVERALL DIMENSIONS (closed box, L x W x H): ${d.inch}${d.est ? " (approximate)" : ""}. ` +
      `You MUST include a clear "Dimensions" line/section stating this overall size IN INCHES exactly as given. ` +
      `Do not convert to cm and do not state any other overall size.`;
    console.log(`${d.label.padEnd(9)} ${d.inch}${d.est ? "  (est)" : ""}`);
    if (APPLY) await prisma.product.update({ where: { id: cid }, data: { productContext: base + note } });
  }

  if (!APPLY) { console.log(`\n[dry-run] --apply to write context + re-run description rule`); await prisma.$disconnect(); return; }

  // ── 2. re-run description rule (parallel) ──
  console.log(`\nRe-running description rule (parallel)...`);
  await Promise.all(Object.keys(DIMS).map((cid) => reapplyRules(cid, ["description"]).then(() => console.log(`  ✓ desc ${cid}`)).catch((e) => console.warn(`  ! desc ${cid}: ${e instanceof Error ? e.message : e}`))));

  // ── 3. verify + inject fallback ──
  console.log(`\nVerifying dimensions present...`);
  for (const [cid, d] of Object.entries(DIMS)) {
    const p = await prisma.product.findUnique({ where: { id: cid }, select: { descriptionHtml: true } });
    const html = p?.descriptionHtml ?? "";
    const dimsCore = d.inch.replace(/\s*in$/, ""); // "14.1 x 7.9 x 5.1"
    const present = html.includes(dimsCore) || html.toLowerCase().includes(dimsCore.toLowerCase());
    if (present) { console.log(`  ✓ ${d.label}: dims present`); continue; }
    const block = `\n<h3>Dimensions</h3>\n<p><strong>Overall size (L x W x H):</strong> ${d.inch}${d.est ? " (approx.)" : ""}</p>`;
    await prisma.product.update({ where: { id: cid }, data: { descriptionHtml: html + block } });
    console.log(`  + ${d.label}: dims were missing — injected Dimensions block`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
