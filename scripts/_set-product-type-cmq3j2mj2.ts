/* Set productType = "watch" for cmq3j2mj20032w2p8arpaf42z */
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

const PID = "cmq3j2mj20032w2p8arpaf42z";

(async () => {
  const p = new PrismaClient();
  const before = await p.product.findUnique({ where: { id: PID }, select: { id: true, productType: true, title: true } });
  console.log("BEFORE:", before);
  const after = await p.product.update({ where: { id: PID }, data: { productType: "watch" }, select: { id: true, productType: true, title: true } });
  console.log("AFTER:", after);
  await p.$disconnect();
})();
