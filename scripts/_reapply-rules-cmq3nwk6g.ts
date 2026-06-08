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
  const { reapplyRules } = await import("../src/services/rule.service");
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log(`Reapplying rules for ${PID}...`);
  try {
    await reapplyRules(PID, ["description", "image", "title", "tags", "seo"]);
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  } catch (e) {
    console.error("FAIL:", e instanceof Error ? e.message : String(e));
  }
  await prisma.$disconnect();
})();
