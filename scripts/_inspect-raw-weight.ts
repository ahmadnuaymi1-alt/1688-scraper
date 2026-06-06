import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";
const PID = process.argv[2] || "cmpxvghau000hw260fnktskfz";
(async () => {
  const p = await prisma.product.findUnique({ where: { id: PID }, select: { rawPayload: true } });
  const raw = JSON.parse(p!.rawPayload) as Record<string, unknown>;
  for (const k of ["price", "productWeightG", "packingDimensionsRows", "featureAttributes"]) {
    console.log(`\n========= rawPayload.${k} =========`);
    console.log(JSON.stringify(raw[k], null, 2).slice(0, 3000));
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
