/** Step 1 DB write: set productType="jewelry-box" for cmq48l750000jw25kdq7dicq4. Sequential single write. */
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

const PID = "cmq48l750000jw25kdq7dicq4";

(async () => {
  const p = new PrismaClient();
  try {
    const before = await p.product.findUnique({ where: { id: PID }, select: { productType: true } });
    console.log("before productType:", JSON.stringify(before?.productType));
    const updated = await p.product.update({
      where: { id: PID },
      data: { productType: "jewelry-box" },
      select: { productType: true },
    });
    console.log("after  productType:", JSON.stringify(updated.productType));
  } finally {
    await p.$disconnect();
  }
})();
