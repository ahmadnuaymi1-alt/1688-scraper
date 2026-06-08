/**
 * Apply gallery preset order to the 5 completed batch products from Phase 0e.
 * cmq3yck9q was deleted by the user (single-variant cleanup). Sequential — respect
 * connection_limit=1.
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

const PIDS = [
  "cmq3ydo0l000jw288ns3doet5",
  "cmq3ycad2000jw2tovgytqkld",
  "cmq3ybrqm000jw25g2h0dyzbp",
  "cmq3yf1eq000jw2kcemhuhsp9",
  "cmq3yc012000jw2a8sm8e0sgg",
];

(async () => {
  const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");
  const prisma = new PrismaClient();
  for (const pid of PIDS) {
    const t0 = Date.now();
    try {
      const r = await applyGalleryPreset(pid);
      console.log(`${pid}  total=${r.totalImages}  lead=${r.leadHeroImageId?.slice(-8) ?? "—"}  life=${r.lifestyleCount}  starred=${r.starredCount}  uploaded=${r.uploadedCount}  trailing=${r.trailingHeroCount}  remainder=${r.remainderCount}  (${Date.now() - t0}ms)`);
    } catch (e) {
      console.error(`${pid}  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await prisma.$disconnect();
})();
