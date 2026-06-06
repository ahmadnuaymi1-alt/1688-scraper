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
const IDS = [
  "cmpspbahc00c6w24cjae7uv6j",
  "cmpspad7h0096w24cnrxdgycr",
  "cmpspa7wm0075w24ccqg9mzbn",
  "cmpsp94gm001nw24cpwbzd5o0",
];

(async () => {
  const result: Array<{ productId: string; title: string; lifestyleCount_before: number }> = [];
  for (const id of IDS) {
    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    const lifestyleCount = await prisma.productImage.count({
      where: { productId: id, imageType: "lifestyle" },
    });
    result.push({
      productId: id,
      title: (product?.title ?? "").slice(0, 60),
      lifestyleCount_before: lifestyleCount,
    });
  }
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
})();
