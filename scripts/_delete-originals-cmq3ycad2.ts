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

const PID = "cmq3ycad2000jw2tovgytqkld";

async function main() {
  const prisma = new PrismaClient();
  // Originals = imageType IS NULL AND keep = false AND host endsWith .alicdn.com
  const allOriginals = await prisma.productImage.findMany({
    where: { productId: PID, imageType: null, keep: false },
    select: { id: true, sourceUrl: true, storagePath: true },
  });
  const toDelete = allOriginals.filter(img => {
    const host = img.sourceUrl ? new URL(img.sourceUrl).host : "";
    return host.endsWith(".alicdn.com");
  });
  console.log(`Found ${allOriginals.length} unstarred imageType=null images, ${toDelete.length} from alicdn.`);

  const kept = await prisma.productImage.count({
    where: { productId: PID, imageType: null, keep: true },
  });

  const ids = toDelete.map(i => i.id);
  if (ids.length === 0) {
    console.log("Nothing to delete.");
  } else {
    const r = await prisma.productImage.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted ${r.count} originals.`);
  }
  console.log(`Kept (starred) originals: ${kept}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
