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
const PID = "cmq3j2qot004dw2p89csu44b3";
(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findUnique({ where: { id: PID }, select: { title: true } });
  console.log(`title: ${prod?.title}`);
  const variants = await p.variant.findMany({ where: { productId: PID, isHidden: false }, select: { position: true, title: true, featuredImageId: true }, orderBy: { position: "asc" } });
  console.log(`${variants.length} visible variants`);
  const [h, l, c] = await Promise.all([
    p.productImage.count({ where: { productId: PID, imageType: "hero-flat" } }),
    p.productImage.count({ where: { productId: PID, imageType: "lifestyle" } }),
    p.productImage.count({ where: { productId: PID, imageType: "closeup" } }),
  ]);
  console.log(`existing: hero-flat=${h} lifestyle=${l} closeup=${c}`);
  await p.$disconnect();
})();
