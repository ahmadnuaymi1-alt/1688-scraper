/**
 * Agent-mode Step 9 + 9.5: reapply rules and then apply the gallery preset for cmq3j26mt001jw2p8u0fby3x4.
 * Runs the rule pipeline (description, image, title, tags, seo) then orders the gallery.
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

const PID = "cmq3j26mt001jw2p8u0fby3x4";

(async () => {
  const { reapplyRules } = await import("../src/services/rule.service");
  const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");

  console.log(`[Step 9] reapplyRules for ${PID} — categories: description, image, title, tags, seo`);
  const reapplyResult = await reapplyRules(PID, ["description", "image", "title", "tags", "seo"]);
  console.log(`  reapply result:`, JSON.stringify(reapplyResult, null, 2));

  console.log(`[Step 9.5] applyGalleryPreset for ${PID}`);
  const presetResult = await applyGalleryPreset(PID);
  console.log(`  preset result:`, JSON.stringify(presetResult, null, 2));

  process.exit(0);
})();
