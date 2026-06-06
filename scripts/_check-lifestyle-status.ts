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
  "cmpvdulx5005nw2hkaid59oes","cmpvdueu50047w2hktmugaati",
];
(async () => {
  const p = new PrismaClient();
  for (const id of IDS) {
    const prod = await p.product.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!prod) { console.log(`  ✗ ${id}  PRODUCT MISSING`); continue; }
    const [lifestyle, closeup] = await Promise.all([
      p.productImage.count({ where: { productId: id, imageType: "lifestyle" } }),
      p.productImage.count({ where: { productId: id, imageType: "closeup" } }),
    ]);
    const need = lifestyle < 6 || closeup < 1;
    const flag = need ? "○" : "✓";
    console.log(`  ${flag} ${id}  lifestyle=${lifestyle}  closeup=${closeup}  (${(prod.title ?? "").slice(0, 40)})`);
  }
  await p.$disconnect();
})();
