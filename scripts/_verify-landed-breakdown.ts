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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
(async () => {
  const p = new PrismaClient();
  const prod = await p.product.findUnique({ where: { id: "cmppv892200t9w2vsh5vgmgmg" }, select: { pricingNotes: true } });
  if (!prod?.pricingNotes) { console.log("no pricing notes"); process.exit(0); }
  const notes = JSON.parse(prod.pricingNotes);
  console.log("landedCostBreakdown:");
  console.log(JSON.stringify(notes.landedCostBreakdown, null, 2));
  await p.$disconnect();
})();
