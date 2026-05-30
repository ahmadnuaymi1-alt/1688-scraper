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
    where: { sourceUrl: "https://detail.1688.com/offer/853066431184.html" },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          variants: { where: { isHidden: false }, select: { id: true } },
          images: {
            where: { imageType: "lifestyle" },
            select: { id: true, position: true, storagePath: true },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });
  console.log(`status: ${j?.status}`);
  console.log(`productId: ${j?.product?.id}`);
  console.log(`title: ${j?.product?.title?.slice(0, 70)}`);
  console.log(`variants: ${j?.product?.variants.length ?? 0}`);
  console.log(`lifestyles: ${j?.product?.images.length ?? 0}`);
  await prisma.$disconnect();
})();
