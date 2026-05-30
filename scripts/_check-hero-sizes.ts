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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.productImage.findMany({
    where: {
      productId: "cmppqg7nw002hw2vsohivuebc",
      imageType: "hero-flat",
    },
    select: { position: true, storagePath: true },
    take: 3,
  });
  for (const r of rows) {
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${r.storagePath}`;
    const res = await fetch(url, { method: "HEAD" });
    console.log(
      `pos=${r.position}  status=${res.status}  size=${res.headers.get("content-length")}  type=${res.headers.get("content-type")}`,
    );
  }
  await prisma.$disconnect();
})();
