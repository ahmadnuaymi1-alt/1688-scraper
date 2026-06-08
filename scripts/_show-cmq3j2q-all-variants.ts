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
  const vs = await p.variant.findMany({ where: { productId: "cmq3j2qot004dw2p89csu44b3" }, select: { id: true, position: true, title: true, isHidden: true, featuredImageId: true }, orderBy: { position: "asc" } });
  for (const v of vs) console.log(`pos${String(v.position).padStart(2, " ")} id=${v.id} hidden=${v.isHidden} feat=${v.featuredImageId?.slice(0,12)} title=${v.title}`);
  await p.$disconnect();
})();
