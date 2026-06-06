/**
 * Inventory every product that was successfully uploaded to Vilvida AND that
 * still has rawPayload data locally (we need rawPayload to compute true
 * landed cost — anything without it can't go through the new methodology
 * without a full re-scrape).
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

(async () => {
  const p = new PrismaClient();

  // Get all successful Vilvida uploads.
  const uploads = await p.uploadRecord.findMany({
    where: { status: "success" },
    orderBy: { completedAt: "desc" },
    select: {
      id: true, shopifyHandle: true, shopifyProductId: true, completedAt: true,
      product: {
        select: {
          id: true, title: true,
          variants: { take: 1, orderBy: { position: "asc" }, select: { price: true, supplierCost: true, weight: true } },
        },
      },
      connection: { select: { storeDomain: true, label: true } },
    },
  });

  // Also count all-uploads-ever and all-products-in-DB so we know the total picture.
  const allUploads = await p.uploadRecord.count();
  const successUploads = await p.uploadRecord.count({ where: { status: "success" } });
  const failedUploads = await p.uploadRecord.count({ where: { status: "failed" } });
  const totalProducts = await p.product.count();
  const productsWithRaw = await p.product.count({ where: { NOT: { rawPayload: "" } } });

  console.log(`\nTOTAL counts:`);
  console.log(`  ScrapeJobs / products in local DB: ${totalProducts}`);
  console.log(`  Products with rawPayload: ${productsWithRaw}`);
  console.log(`  UploadRecord rows total: ${allUploads}`);
  console.log(`  UploadRecord status=success: ${successUploads}`);
  console.log(`  UploadRecord status=failed: ${failedUploads}`);

  console.log(`\nSuccessful Vilvida uploads (newest first):`);
  for (const u of uploads) {
    console.log(`  ${u.product?.id ?? "?"}  handle=${u.shopifyHandle}`);
    console.log(`     title: ${u.product?.title}`);
  }
  await p.$disconnect();
})();
