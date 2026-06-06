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
const IDS = [
  "cmpvdwok500frw2hk9nmld4k0","cmpvdvyra00dbw2hktxto64m0","cmpvdvrbu00atw2hk09s9sds6",
  "cmpvdv330000jtzr0x291djgp","cmpvdv27r008sw2hk94xcdomh","cmpvduv67007jw2hknhvxnqwe",
  "cmpvdulx5005nw2hkaid59oes","cmpvdueu50047w2hktmugaati","cmpvdu7sd002zw2hkznd00mrj",
  "cmpvdtmd5001jw2hkkqjdvy5k",
];
(async () => {
  const p = new PrismaClient();
  for (const id of IDS) {
    const variants = await p.variant.findMany({ where: { productId: id }, select: { title: true, price: true, compareAtPrice: true }, orderBy: { position: "asc" } });
    const priceEnds = variants.map((v) => parseFloat(v.price)).filter((n) => Number.isFinite(n)).map((n) => Math.floor(n) % 10);
    const bad = priceEnds.filter((d) => d !== 4 && d !== 9);
    const cmpRemaining = variants.filter((v) => v.compareAtPrice != null && v.compareAtPrice !== "").length;
    const minP = Math.min(...variants.map((v) => parseFloat(v.price)));
    const maxP = Math.max(...variants.map((v) => parseFloat(v.price)));
    console.log(`  ${id}  ${variants.length} var  range=$${minP}–$${maxP}  invalidEndings=${bad.length}  compareAtNonNull=${cmpRemaining}`);
  }
  await p.$disconnect();
})();
