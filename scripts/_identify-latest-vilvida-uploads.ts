/**
 * Identify the most recent successful product uploads to the Vilvida Shopify
 * store. The user wants to fill image-with-text + FAQ metafields on the "latest
 * nine products" — this script just lists candidates so we can confirm which
 * 9 to target before running generation.
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

const N = parseInt(process.argv[2] ?? "15", 10);

(async () => {
  const prisma = new PrismaClient();
  const conn = await prisma.shopifyConnection.findFirst({ where: { label: "Vilvida" }, select: { id: true } });
  if (!conn) { console.error("no Vilvida connection"); process.exit(1); }

  const uploads = await prisma.uploadRecord.findMany({
    where: { connectionId: conn.id, status: "success" },
    orderBy: { createdAt: "desc" },
    take: N,
    select: {
      createdAt: true,
      shopifyProductId: true,
      product: { select: { id: true, title: true, handle: true } },
    },
  });

  console.log(`Most recent ${uploads.length} successful Vilvida uploads:\n`);
  console.log(`createdAt                  productId                       title (truncated)`);
  console.log(`-------------------------- -------------------------------- ----------------------------------------`);
  for (const u of uploads) {
    const dt = u.createdAt.toISOString().slice(0, 19).replace("T", " ");
    const pid = u.product?.id ?? "?";
    const t = (u.product?.title ?? "?").slice(0, 60);
    console.log(`${dt}        ${pid.padEnd(28)}     ${t}`);
  }
  await prisma.$disconnect();
})();
