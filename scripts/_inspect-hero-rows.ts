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
  // Pick the cleanest case: cmpvduv67007jw2hknhvxnqwe (1 variant, 2 hero rows)
  const rows = await p.productImage.findMany({
    where: { productId: "cmpvduv67007jw2hknhvxnqwe", imageType: "hero-flat" },
    orderBy: { createdAt: "asc" },
  });
  console.log(`cmpvduv67007jw2hknhvxnqwe — ${rows.length} hero-flat row(s):\n`);
  for (const r of rows) {
    console.log(`  id=${r.id}  variantId=${r.variantId}  pos=${r.position}  created=${r.createdAt.toISOString()}`);
    console.log(`    sourceUrl=${r.sourceUrl}`);
    console.log(`    storagePath=${r.storagePath}`);
    console.log(`    fileName=${r.fileName}`);
    console.log(``);
  }
  // Also: are any variants pointing to these heroes via featuredImageId?
  const vars = await p.variant.findMany({ where: { productId: "cmpvduv67007jw2hknhvxnqwe" }, select: { id: true, title: true, featuredImageId: true } });
  for (const v of vars) console.log(`  variant ${v.id} (${v.title}) featuredImageId=${v.featuredImageId}`);
  await p.$disconnect();
})();
