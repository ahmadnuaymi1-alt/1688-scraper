/**
 * Show description HTML for bolo tie product cmq3yf1eq000jw2kcemhuhsp9
 * — sanity-check dimension presence + unit (inches vs cm).
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

const PID = "cmq3yf1eq000jw2kcemhuhsp9";

(async () => {
  const p = new PrismaClient();
  try {
    const product = await p.product.findUnique({
      where: { id: PID },
      select: { descriptionHtml: true, productContext: true, rawPayload: true, variants: { select: { packagingDimensions: true } } },
    });
    console.log("=== descriptionHtml ===");
    console.log(product?.descriptionHtml ?? "(null)");
    console.log("\n=== productContext ===");
    console.log(JSON.stringify(product?.productContext ?? null, null, 2));
    console.log("\n=== variant.packagingDimensions ===");
    for (const v of product?.variants ?? []) {
      console.log(JSON.stringify(v.packagingDimensions ?? null));
    }
  } finally {
    await p.$disconnect();
  }
})();
