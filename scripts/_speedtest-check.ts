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
const PID = process.argv[2] ?? "cmq40onbk000jw2h0i209ubey";
async function main() {
  const prisma = new PrismaClient();
  const p: any = await prisma.product.findUnique({ where: { id: PID }, include: { images: true } });
  const byType = p.images.reduce((a: any, i: any) => { const k = i.imageType ?? "(source)"; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  console.log("descriptionHtml len:", (p.descriptionHtml ?? "").length);
  console.log("metaDescription:", (p.metaDescription ?? "").slice(0, 160));
  console.log("tags:", (p.tags ?? "").slice(0, 260));
  console.log("images byType:", JSON.stringify(byType), "total", p.images.length);
  console.log("desc first 260:", (p.descriptionHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 260));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
