/** Count heroes for cmq3ybrqm000jw25g2h0dyzbp */
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";

(async () => {
  const p = new PrismaClient();
  try {
    const heroCount = await p.productImage.count({
      where: { productId: PID, imageType: { in: ["hero", "hero-flat"] } },
    });
    const lifeCount = await p.productImage.count({
      where: { productId: PID, imageType: { in: ["lifestyle", "lifestyle-closeup", "closeup"] } },
    });
    const totalImgs = await p.productImage.count({ where: { productId: PID } });
    console.log(`HEROES: ${heroCount}`);
    console.log(`LIFESTYLES+CLOSEUPS: ${lifeCount}`);
    console.log(`TOTAL IMAGES: ${totalImgs}`);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
