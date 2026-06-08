/** Re-run the image rule (alt-text) + gallery preset for a product. Idempotent.
 *   npx tsx scripts/_speedtest-finalize.ts <productId>
 */
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
async function main() {
  if (!PID) throw new Error("usage: _speedtest-finalize.ts <productId>");
  const { reapplyRules } = await import("../src/services/rule.service");
  const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");
  try { await reapplyRules(PID, ["image"] as any); console.log("image rule ok"); }
  catch (e) { console.log("image rule FAILED:", e instanceof Error ? e.message.slice(0, 100) : e); }
  try { await applyGalleryPreset(PID); console.log("gallery preset ok"); }
  catch (e) { console.log("gallery preset FAILED:", e instanceof Error ? e.message.slice(0, 100) : e); }
}
main().catch((e) => { console.error(e); process.exit(1); });
