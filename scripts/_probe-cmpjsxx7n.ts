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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: "cmpjsxx7n010pw2ggqsx242gf" },
    select: { id: true, title: true, descriptionHtml: true, productContext: true },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", p.title);
  const html = p.descriptionHtml ?? "";
  const imgCount = (html.match(/<img/gi) ?? []).length;
  const textLen = html.replace(/<[^>]+>/g, "").trim().length;
  console.log(`descriptionHtml: ${html.length} chars total, ${imgCount} <img> tags, ${textLen} chars of text (stripped)`);
  console.log(`--- First 600 chars of descriptionHtml ---`);
  console.log(html.slice(0, 600));
  console.log(`--- Last 300 chars of descriptionHtml ---`);
  console.log(html.slice(-300));
  console.log("");
  if (p.productContext) {
    try {
      const ctx = JSON.parse(p.productContext);
      console.log("productContext keys:", Object.keys(ctx));
      console.log("  extractedSpecs:", Array.isArray(ctx.extractedSpecs) ? ctx.extractedSpecs.length : "missing");
      console.log("  featureCallouts:", Array.isArray(ctx.featureCallouts) ? ctx.featureCallouts.length : "missing");
      console.log("  marketingAngles:", Array.isArray(ctx.marketingAngles) ? ctx.marketingAngles.length : "missing");
      console.log("  supplierAttributes:", Array.isArray(ctx.supplierAttributes) ? ctx.supplierAttributes.length : "missing");
    } catch (e) {
      console.log("productContext: failed to parse JSON");
    }
  } else {
    console.log("productContext: null");
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
