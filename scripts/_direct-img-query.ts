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
const IDS = process.argv.slice(2);
(async () => {
  const p = new PrismaClient();
  for (const PID of IDS) {
    console.log(`\n=== ${PID} ===`);
    const all = await p.productImage.findMany({ where: { productId: PID }, select: { id: true, imageType: true, variantId: true, fileName: true, storagePath: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 30 });
    console.log(`${all.length} ProductImage rows total. By imageType:`);
    const counts = new Map<string, number>();
    for (const r of all) {
      const t = JSON.stringify(r.imageType);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [t, n] of counts) console.log(`  type=${t}: ${n}`);
    const variants = await p.variant.findMany({ where: { productId: PID, isHidden: false }, select: { id: true, title: true, featuredImageId: true } });
    console.log(`\n${variants.length} visible variants:`);
    for (const v of variants) {
      const img = v.featuredImageId ? await p.productImage.findUnique({ where: { id: v.featuredImageId }, select: { imageType: true, storagePath: true } }) : null;
      console.log(`  ${v.id}  featuredId=${v.featuredImageId}  imgType=${img?.imageType ?? "—"}  storage=${img?.storagePath?.slice(-50) ?? "—"}  (${(v.title ?? "").slice(0, 40)})`);
    }
  }
  await p.$disconnect();
})();
