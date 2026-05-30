/**
 * Diagnostic: run uploadProductToShopify directly for one product, print the
 * actual error message + stack. Used to flush out the bulk-upload failure.
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
import { uploadProductToShopify } from "../src/services/uploader.service";

async function main() {
  const productId = process.argv[2] || "cmpjsx9f700thw2gg2r2kiukv";
  const connectionId = process.argv[3] || "cmpilpenl01adw2f04rg7nmtl";
  console.log(`[diag] product=${productId}  connection=${connectionId}`);
  const t0 = Date.now();
  try {
    const r = await uploadProductToShopify(productId, connectionId);
    const sec = Math.round((Date.now() - t0) / 1000);
    console.log(`[diag] OK ${sec}s`);
    console.log(JSON.stringify(r, null, 2).slice(0, 1500));
  } catch (e) {
    const sec = Math.round((Date.now() - t0) / 1000);
    console.error(`[diag] FAIL ${sec}s — ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.error(e.stack.slice(0, 2000));
  }
}
main().catch((e) => { console.error("UNHANDLED:", e); process.exit(1); });
