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
  const prods = await p.product.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true, title: true, createdAt: true,
      uploads: { select: { shopifyProductId: true, shopifyHandle: true, status: true } },
      variants: { take: 3, orderBy: { position: "asc" }, select: { title: true, price: true, supplierCost: true, weight: true } },
      _count: { select: { variants: true } },
    },
  });
  for (const pr of prods) {
    const ageMin = Math.round((Date.now() - new Date(pr.createdAt).getTime()) / 60000);
    const upload = pr.uploads[0];
    console.log(`${pr.id}  ${ageMin}m ago  ${pr._count.variants}var  uploaded=${upload ? upload.status : "NO"}`);
    console.log(`   title: ${(pr.title ?? "").slice(0, 70)}`);
    if (upload?.shopifyHandle) console.log(`   handle: ${upload.shopifyHandle}`);
    for (const v of pr.variants.slice(0, 2)) console.log(`     pos: ${v.title?.slice(0,30)} price=$${v.price} supplier=${v.supplierCost ?? "?"} weight=${v.weight ?? "?"}`);
  }
  await p.$disconnect();
})();
