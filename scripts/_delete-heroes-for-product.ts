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
const PID = process.argv[2];
if (!PID) { console.error("usage: <productId>"); process.exit(1); }
(async () => {
  const p = new PrismaClient();
  const heroes = await p.productImage.findMany({ where: { productId: PID, imageType: { in: ["hero", "hero-flat"] } }, select: { id: true } });
  console.log(`Found ${heroes.length} hero/hero-flat row(s) for ${PID}`);
  const heroIds = heroes.map((h) => h.id);
  if (heroIds.length > 0) {
    // Null out variant.featuredImageId pointers
    const upd = await p.variant.updateMany({ where: { productId: PID, featuredImageId: { in: heroIds } }, data: { featuredImageId: null } });
    console.log(`Unlinked ${upd.count} variant.featuredImageId pointers`);
    const del = await p.productImage.deleteMany({ where: { id: { in: heroIds } } });
    console.log(`Deleted ${del.count} ProductImage row(s)`);
  }
  await p.$disconnect();
})();
