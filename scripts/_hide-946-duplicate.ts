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

const prisma = new PrismaClient();
(async () => {
  const j = await prisma.scrapeJob.findFirst({
    where: { sourceUrl: { contains: "946467767757" } },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: { variants: { where: { isHidden: false }, orderBy: { position: "asc" } } },
      },
    },
  });
  if (!j?.product) {
    console.log("not found");
    return;
  }
  const dup = j.product.variants.find((v) => v.position === 7);
  if (!dup) {
    console.log("pos 7 already hidden or missing");
    return;
  }
  await prisma.variant.update({ where: { id: dup.id }, data: { isHidden: true } });
  console.log(`Hid pos=7 duplicate (id=${dup.id})`);
  const remaining = await prisma.variant.count({
    where: { productId: j.product.id, isHidden: false },
  });
  console.log(`Visible now: ${remaining}`);
  await prisma.$disconnect();
})();
