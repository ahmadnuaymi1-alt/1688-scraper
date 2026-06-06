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
  const conns = await p.shopifyConnection.findMany({
    select: { id: true, label: true, storeDomain: true, isDefault: true },
  });
  console.log("ShopifyConnections:", JSON.stringify(conns, null, 2));
  // Recent uploads to see what's actually live on the store
  const uploads = await p.uploadRecord.findMany({
    where: { status: { in: ["success", "completed", "ok"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, shopifyHandle: true, shopifyProductId: true, completedAt: true,
      product: { select: { id: true, title: true } },
      connection: { select: { storeDomain: true } },
    },
  });
  console.log("\nRecent successful uploads:", JSON.stringify(uploads, null, 2));
  await p.$disconnect();
})();
