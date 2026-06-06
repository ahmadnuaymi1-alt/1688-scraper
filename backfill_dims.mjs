import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, ""); if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const TARGET_IDS = ["cmpy0qxxy00h0w260ulj2z675", "cmpy0tub800pjw260s61len3m"];

// cm -> inch, 1 decimal
const inch = (cm) => Math.round(cm * 0.394 * 10) / 10;

// Parse "26 × 16.5 × 8.7 cm" or "30×23×5.9cm" or "26*16.5*8.7" -> [26,16.5,8.7]
function parseCm(s) {
  if (!s) return null;
  const nums = (s.match(/[\d]+(?:\.\d+)?/g) || []).map(Number);
  return nums.length >= 2 ? nums.slice(0, 3) : null;
}

// Build canonical catalog value. 3 nums -> W×H×D, 2 nums -> W×H
function toCanonical(cmArr) {
  const v = cmArr.map(inch);
  if (v.length === 3) return `${v[0]}"W × ${v[1]}"H × ${v[2]}"D`;
  return `${v[0]}"W × ${v[1]}"H`;
}

const backupDir = path.resolve(process.cwd(), ".tmp-dim-backfill");
if (APPLY && !fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

for (const id of TARGET_IDS) {
  const p = await prisma.product.findUnique({
    where: { id },
    select: { id: true, title: true, descriptionHtml: true, productContext: true,
              variants: { select: { packagingDimensions: true }, take: 5 } },
  });
  if (!p) { console.log(`${id}: NOT FOUND`); continue; }

  // Source dimension: prefer variant.packagingDimensions, fallback to supplier 规格/尺寸
  let cmArr = null, src = "";
  const vdim = p.variants.map(v => v.packagingDimensions).find(Boolean);
  if (vdim) { cmArr = parseCm(vdim); src = `packagingDimensions="${vdim}"`; }
  if (!cmArr) {
    let ctx = null; try { ctx = JSON.parse(p.productContext || "null"); } catch {}
    const a = (ctx?.supplierAttributes || []).find(x => /规格|尺寸|size|dimension/i.test(x.name) && parseCm(x.value));
    if (a) { cmArr = parseCm(a.value); src = `supplierAttr ${a.name}="${a.value}"`; }
  }
  if (!cmArr) { console.log(`${id}: no parseable dimension source — SKIP`); continue; }

  const value = toCanonical(cmArr);
  const html = p.descriptionHtml || "";

  // Idempotency: skip if a Dimensions row/spec already present
  if (/<th>\s*Dimensions?\s*<\/th>/i.test(html)) {
    console.log(`${id}: descriptionHtml already has a Dimensions row — SKIP`);
    continue;
  }

  // Insert the row before the first Weight row inside the Specifications table;
  // fall back to before the closing </table>.
  const row = `  <tr><th>Dimensions</th><td>${value}</td></tr>\n`;
  let newHtml;
  const weightRe = /(\s*<tr><th>Weight<\/th>)/i;
  if (weightRe.test(html)) {
    newHtml = html.replace(weightRe, `\n${row.trimEnd()}$1`);
  } else {
    newHtml = html.replace(/(\s*<\/table>)/i, `\n${row.trimEnd()}$1`);
  }

  // Update extractedSpecs (add Dimensions if absent)
  let ctx = null; try { ctx = JSON.parse(p.productContext || "null"); } catch {}
  if (!ctx || typeof ctx !== "object") ctx = { extractedSpecs: [], featureCallouts: [], marketingAngles: [] };
  if (!Array.isArray(ctx.extractedSpecs)) ctx.extractedSpecs = [];
  const hasDimSpec = ctx.extractedSpecs.some(s => /dimension/i.test(s?.name || ""));
  if (!hasDimSpec) ctx.extractedSpecs.push({ name: "Dimensions", value });

  console.log("\n" + "=".repeat(80));
  console.log(`${id} | ${p.title.slice(0, 60)}`);
  console.log(`  source: ${src}`);
  console.log(`  cm ${cmArr.join(" × ")} → "${value}"`);
  console.log(`  html changed: ${newHtml !== html}`);

  if (APPLY) {
    fs.writeFileSync(path.join(backupDir, `${id}.json`),
      JSON.stringify({ descriptionHtml: p.descriptionHtml, productContext: p.productContext }, null, 2));
    await prisma.product.update({
      where: { id },
      data: { descriptionHtml: newHtml, productContext: JSON.stringify(ctx) },
    });
    console.log(`  ✅ APPLIED (backup → .tmp-dim-backfill/${id}.json)`);
  } else {
    console.log(`  (dry-run; pass --apply to write)`);
  }
}
await prisma.$disconnect();
