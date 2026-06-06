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
  const id = process.argv[2] ?? "cmpspa7wm0075w24ccqg9mzbn";
  const p = new PrismaClient();
  const job = await p.scrapeJob.findFirst({
    where: { product: { id } },
    select: { id: true, sourceUrl: true, options: true, createdAt: true },
  });
  console.log("job:", JSON.stringify(job, null, 2));
  const variants = await p.variant.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
    select: { position: true, title: true, price: true, supplierCost: true, weight: true, weightUnit: true, sku: true, sourceVariantId: true },
    take: 4,
  });
  console.log("\nfirst 4 variants raw:");
  for (const v of variants) console.log(JSON.stringify(v));
  await p.$disconnect();
})();
