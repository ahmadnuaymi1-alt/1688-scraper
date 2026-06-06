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
(async () => {
  const p = new PrismaClient();
  const prods = await p.product.findMany({
    orderBy: { createdAt: "desc" },
    take: 9,
    select: { id: true, title: true, createdAt: true,
      _count: { select: { variants: true, images: true } } },
  });
  console.log(`\nLatest 9 products:`);
  console.log(prods.map((p) => p.id).join(","));
  console.log(`\nDetails:`);
  for (const pr of prods) {
    console.log(`  ${pr.createdAt.toISOString().slice(0, 19)}  ${pr.id}  vars=${pr._count.variants}  imgs=${pr._count.images}  ${(pr.title ?? "").slice(0, 50)}`);
  }
  await p.$disconnect();
})();
