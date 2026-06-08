import fs from "node:fs";
import path from "node:path";
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
const PID = process.argv[2];
const CATS = (process.argv[3] ?? "description,image,title,tags,seo").split(",").map(s => s.trim()).filter(Boolean);
async function main() {
  if (!PID) throw new Error("usage: _speedtest2-reapply.ts <pid> <csvCategories>");
  const { reapplyRules } = await import("../src/services/rule.service");
  await reapplyRules(PID, CATS as any);
  console.log("reapply done:", CATS.join(","));
}
main().catch((e) => { console.error(e); process.exit(1); });
