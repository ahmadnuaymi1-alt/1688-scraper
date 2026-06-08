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
  const before = await prisma.product.findUnique({ where: { id: PID }, include: { variants: true, images: true } });
  if (!before) throw new Error("no product");
  console.log(`BEFORE type=${before.productType} names=${JSON.stringify(before.optionNames)} variants=${before.variants.length} visible=${before.variants.filter(v => !v.isHidden).length} images=${before.images.length}`);

  await prisma.product.update({ where: { id: PID }, data: { productType: "watch" } });
  await prisma.variant.updateMany({ where: { productId: PID, isHidden: true }, data: { isHidden: false } });

  const all = await prisma.variant.findMany({ where: { productId: PID }, orderBy: { position: "asc" } });
  if (all.length === 1) {
    await prisma.product.update({ where: { id: PID }, data: { optionNames: ["Title"] } });
    await prisma.variant.update({ where: { id: all[0].id }, data: { option1: "Default Title" } });
    console.log("single-variant Title convention applied");
  }

  const after = await prisma.product.findUnique({ where: { id: PID }, include: { variants: true, images: true } });
  console.log(`AFTER  type=${after!.productType} names=${JSON.stringify(after!.optionNames)} visible=${after!.variants.filter(v => !v.isHidden).length} images=${after!.images.length}`);
  for (const v of after!.variants) console.log(`  #${v.position} hidden=${v.isHidden} opt1=${v.option1} feat=${v.featuredImageId ?? "null"}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
