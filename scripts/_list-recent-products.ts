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
    take: 10,
    select: { id: true, title: true, createdAt: true, _count: { select: { images: true, variants: true } } },
  });
  for (const r of prods) console.log(`${r.id}  imgs=${r._count.images}  vars=${r._count.variants}  ${(r.title || "").slice(0, 60)}`);
  await p.$disconnect();
})();
