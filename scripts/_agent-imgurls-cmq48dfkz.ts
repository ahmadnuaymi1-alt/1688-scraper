/** Dump full image URLs + which variant points at which featured image. Read-only. */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
function loadEnvLocal(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
const ID = "cmq48dfkz000jw2ik1ziakg6o";
async function main() {
  const prisma = new PrismaClient();
  const r = await prisma.product.findUnique({ where: { id: ID }, include: { variants: { orderBy: { position: "asc" } }, images: { orderBy: { position: "asc" } } } });
  if (!r) { console.log("NOT FOUND"); await prisma.$disconnect(); return; }
  for (const im of r.images) {
    process.stdout.write(`IMG id=${im.id} pos=${im.position} type=${im.imageType ?? "null"}\n  url=${im.url}\n  storagePath=${(im as any).storagePath ?? "n/a"}\n`);
  }
  process.stdout.write("\n=== VARIANT -> featuredImage ===\n");
  for (const v of r.variants) {
    const fi = r.images.find((i) => i.id === v.featuredImageId);
    process.stdout.write(`${v.option1} -> featuredImageId=${v.featuredImageId}\n  featured url=${fi?.url ?? "MISSING"}\n`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
