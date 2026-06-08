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
const PID = "cmq3j2qot004dw2p89csu44b3";
(async () => {
  const p = new PrismaClient();
  const imgs = await p.productImage.findMany({ where: { productId: PID }, select: { id: true, position: true, imageType: true, variantId: true }, orderBy: { position: "asc" } });
  console.log(`${imgs.length} ProductImages for ${PID}:`);
  for (const i of imgs) console.log(`  pos${String(i.position).padStart(3, " ")}  id=${i.id.slice(0, 12)}  type=${i.imageType ?? "null"}  variantId=${i.variantId ?? "—"}`);
  await p.$disconnect();
})();
