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

(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findUnique({
    where: { id: "cmq3nwk6g000jw2hst5cwxfj8" },
    select: { descriptionHtml: true, title: true, tags: true, metaDescription: true, variants: { where: { isHidden: false }, select: { id: true, packagingDimensions: true }, take: 5 } },
  });
  console.log(`Title: ${prod?.title}`);
  console.log(`MetaDesc: ${prod?.metaDescription ?? "(null)"}`);
  console.log(`Tags: ${prod?.tags ?? "(null)"}`);
  console.log(`\nVariant packagingDimensions (first 5 visible):`);
  for (const v of prod?.variants ?? []) console.log(`  ${v.id.slice(-8)}: ${v.packagingDimensions ?? "(null)"}`);
  console.log(`\n=== DESCRIPTION HTML (full) ===`);
  console.log(prod?.descriptionHtml ?? "(empty)");
  await p.$disconnect();
})();
