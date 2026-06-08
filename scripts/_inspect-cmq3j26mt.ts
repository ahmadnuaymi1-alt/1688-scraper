/**
 * Quick inspect: confirm state of cmq3j26mt001jw2p8u0fby3x4 before resuming agent mode.
 */
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

const PID = "cmq3j26mt001jw2p8u0fby3x4";

(async () => {
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PID },
    select: { id: true, title: true, productType: true, handle: true, vendor: true },
  });
  console.log("Product:", product);

  const variants = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      isHidden: true,
      option1: true,
      option2: true,
      option3: true,
      price: true,
      compareAtPrice: true,
      featuredImageId: true,
    },
  });
  console.log(`\nVariants (${variants.length} total, ${variants.filter(v => !v.isHidden).length} visible):`);
  for (const v of variants) {
    console.log(`  pos=${v.position} hidden=${v.isHidden} option1="${v.option1}" featuredImageId=${v.featuredImageId} price=${v.price}`);
  }

  const images = await prisma.productImage.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      imageType: true,
      keep: true,
      sourceUrl: true,
      storagePath: true,
    },
  });
  console.log(`\nProductImages (${images.length} total):`);
  const counts: Record<string, number> = {};
  let alicdnCount = 0;
  for (const img of images) {
    const key = img.imageType ?? "null";
    counts[key] = (counts[key] ?? 0) + 1;
    try {
      const host = new URL(img.sourceUrl).hostname;
      if ((host.endsWith(".alicdn.com") || host === "alicdn.com") && img.imageType === null && !img.keep) {
        alicdnCount++;
      }
    } catch {}
  }
  console.log(`  by imageType:`, counts);
  console.log(`  unstarred .alicdn.com originals (imageType=null, keep=false): ${alicdnCount}`);

  await prisma.$disconnect();
})();
