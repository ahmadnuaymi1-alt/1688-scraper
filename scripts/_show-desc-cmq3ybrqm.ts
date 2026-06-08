/** Show product description + tags for cmq3ybrqm000jw25g2h0dyzbp */
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";

(async () => {
  const p = new PrismaClient();
  try {
    const product = await p.product.findUnique({
      where: { id: PID },
      select: { title: true, descriptionHtml: true, metaDescription: true, tags: true, productContext: true },
    });
    console.log("TITLE:", product?.title);
    console.log("\nTAGS:", product?.tags);
    console.log("\nMETA DESC:", product?.metaDescription);
    console.log("\nDESC HTML (first 3000 chars):");
    console.log((product?.descriptionHtml ?? "").slice(0, 3000));
    console.log(`\n... total description length: ${(product?.descriptionHtml ?? "").length} chars`);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
