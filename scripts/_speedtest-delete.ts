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

const PID = "cmq406kfj000jw2kcgbtfugv6";

async function main() {
  const prisma = new PrismaClient();
  const before = await prisma.productImage.findMany({ where: { productId: PID }, select: { id: true, imageType: true, keep: true } });
  const toDelete = before.filter(i => i.imageType === null && !i.keep);
  const kept = before.filter(i => i.imageType === null && i.keep);
  console.log(`Total=${before.length}  toDelete(originals)=${toDelete.length}  keptStarred=${kept.length}`);

  for (const img of toDelete) {
    await prisma.variant.updateMany({ where: { featuredImageId: img.id }, data: { featuredImageId: null } });
  }
  const result = await prisma.productImage.deleteMany({ where: { productId: PID, imageType: null, keep: false } });

  const after = await prisma.productImage.findMany({ where: { productId: PID }, select: { imageType: true } });
  const counts = after.reduce((a, i) => { const k = i.imageType ?? "null"; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>);
  console.log(`Deleted=${result.count}  After total=${after.length}  byType=${JSON.stringify(counts)}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
