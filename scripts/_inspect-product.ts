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
(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findUnique({
    where: { id: process.argv[2] ?? "cmpochfs1000jw2jooshthkay" },
    select: {
      title: true, productType: true, tags: true, descriptionHtml: true, productContext: true,
      variants: { where: { isHidden: false }, select: { title: true, option1: true, option2: true, option3: true } },
      optionNames: true,
      images: { take: 8, orderBy: { position: "asc" }, select: { sourceUrl: true, altText: true, imageType: true } },
    },
  });
  if (!prod) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", prod.title);
  console.log("Category:", prod.category);
  console.log("Visible variants:", prod.variants.length);
  console.log("Option names:", prod.optionNames);
  console.log("First 8 variant titles:");
  for (const v of prod.variants.slice(0, 8)) console.log("  -", v.title);
  console.log("\nImages (first 8):");
  for (const i of prod.images) console.log("  -", i.imageType ?? "(source)", "|", i.altText?.slice(0, 80) ?? "", "|", i.sourceUrl);
  const ctx = prod.productContext ? JSON.parse(prod.productContext) : null;
  console.log("\nmarketingAngles (first 5):", JSON.stringify(ctx?.marketingAngles?.slice(0,5), null, 2));
  console.log("\nextractedSpecs (first 15):");
  for (const s of (ctx?.extractedSpecs ?? []).slice(0, 15)) console.log("  ", s.name, "=", s.value);
  await p.$disconnect();
})();
