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
const PID = "cmpzifo4s003uw2hsxm35vqyf";
const POSITIONS = [28, 29, 31, 36];
(async () => {
  const p = new PrismaClient();
  const heroes = await p.productImage.findMany({
    where: { productId: PID, imageType: "hero-flat", position: { in: POSITIONS } },
    select: { id: true, position: true, storagePath: true },
    orderBy: { position: "asc" },
  });
  console.log(`Heroes at positions ${POSITIONS.join(", ")}:\n`);
  for (const h of heroes) {
    const variants = await p.variant.findMany({
      where: { productId: PID, featuredImageId: h.id },
      select: { id: true, title: true, position: true },
    });
    // Original 1688 source for these variants — first ProductImage with their variantId AND imageType IS NULL
    const sources = await Promise.all(variants.map(async (v) => {
      const src = await p.productImage.findFirst({
        where: { productId: PID, variantId: v.id, imageType: null },
        orderBy: { position: "asc" },
        select: { id: true, storagePath: true },
      });
      return { v, src };
    }));
    console.log(`  pos#${h.position}  heroId=${h.id}  storage=${h.storagePath?.slice(-50)}`);
    for (const s of sources) {
      console.log(`    variant ${s.v.id} (${s.v.title}) → original 1688 source: ${s.src?.id ?? "MISSING"} ${s.src?.storagePath?.slice(-50) ?? ""}`);
    }
  }
  await p.$disconnect();
})();
