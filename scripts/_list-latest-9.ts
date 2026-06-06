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
  // Show the most recent products that have a successful scrape (status=ready)
  const jobs = await prisma.scrapeJob.findMany({
    where: { status: "ready", product: { isNot: null } },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      product: {
        select: {
          id: true,
          title: true,
          _count: { select: { images: true, variants: true } },
        },
      },
    },
  });
  for (const j of jobs) {
    if (!j.product) continue;
    const heroCount = await prisma.productImage.count({
      where: { productId: j.product.id, imageType: { in: ["hero", "hero-flat"] } },
    });
    const lifestyleCount = await prisma.productImage.count({
      where: { productId: j.product.id, imageType: "lifestyle" },
    });
    console.log(
      `${j.product.id}  created=${j.createdAt.toISOString()}  variants=${j.product._count.variants}  heroes=${heroCount}  lifestyles=${lifestyleCount}  ${(j.product.title ?? "").slice(0, 60)}`,
    );
  }
  await prisma.$disconnect();
})();
