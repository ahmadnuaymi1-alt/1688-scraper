/**
 * Delete the 6 wrongly-classified lifestyle images + 1 closeup that the
 * lifestyle script generated for cmq3nwk6g000jw2hst5cwxfj8 BEFORE the
 * scene-overrides file existed. The scene-designer auto-classified the watch
 * as a "pendant" lighting fixture and generated foyer/dining-room/etc rooms.
 */
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

const PID = "cmq3nwk6g000jw2hst5cwxfj8";

(async () => {
  const p = new PrismaClient();
  try {
    const bad = await p.productImage.findMany({
      where: { productId: PID, imageType: { in: ["lifestyle", "lifestyle-closeup", "closeup"] } },
      select: { id: true, imageType: true, storagePath: true },
    });
    console.log(`Found ${bad.length} wrong-category images to delete:`);
    for (const b of bad) console.log(`  ${b.id.slice(-10)}  type=${b.imageType}  ${b.storagePath?.slice(-50)}`);
    if (bad.length === 0) { console.log("  (nothing to delete)"); return; }
    const r = await p.productImage.deleteMany({
      where: { productId: PID, imageType: { in: ["lifestyle", "lifestyle-closeup", "closeup"] } },
    });
    console.log(`\nDeleted ${r.count} ProductImage row(s).`);
  } finally {
    await p.$disconnect();
  }
})();
