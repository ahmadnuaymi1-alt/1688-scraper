/**
 * The image rule re-ran the lifestyle attach step during reapplyRules, creating
 * duplicate ProductImage rows with the same storagePath. Delete the dupes
 * (keep the earliest-created of each duplicated storagePath).
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
  const imgs = await prisma.productImage.findMany({
    where: { productId: PID, imageType: "lifestyle" },
    orderBy: { createdAt: "asc" },
    select: { id: true, storagePath: true, createdAt: true, position: true },
  });
  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const img of imgs) {
    if (!img.storagePath) continue;
    if (seen.has(img.storagePath)) {
      toDelete.push(img.id);
      console.log(`  delete dup id=${img.id} pos=${img.position} path=${img.storagePath} (keeping earlier id=${seen.get(img.storagePath)})`);
    } else {
      seen.set(img.storagePath, img.id);
    }
  }
  if (toDelete.length === 0) {
    console.log("No duplicates found.");
  } else {
    const result = await prisma.productImage.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`Deleted ${result.count} duplicate ProductImage row(s).`);
  }
  await prisma.$disconnect();
})();
