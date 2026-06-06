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
  const r = await p.product.findUnique({
    where: { id: "cmpspc34s00j0w24c40x2tikh" },
    select: { descriptionHtml: true, productContext: true, rawPayload: true },
  });
  console.log("--- descriptionHtml ---");
  console.log(r?.descriptionHtml);
  console.log("\n--- productContext.extractedSpecs ---");
  try {
    const c = JSON.parse(r?.productContext ?? "{}") as { extractedSpecs?: unknown };
    console.log(JSON.stringify(c.extractedSpecs, null, 2));
  } catch {
    console.log("parse error");
  }
  console.log("\n--- rawPayload.productWeightG ---");
  try {
    const rp = JSON.parse(r?.rawPayload ?? "{}") as { productWeightG?: unknown };
    console.log(rp.productWeightG);
  } catch {
    console.log("parse error");
  }
  await p.$disconnect();
})();
