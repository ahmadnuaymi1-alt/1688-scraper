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

const prisma = new PrismaClient();
(async () => {
  const ids = [
    "cmppqhueh00amw2vsdewbgxhs",
    "cmppqgw3z005mw2vsplzfocnl",
  ];
  for (const id of ids) {
    const c = await prisma.productImage.count({
      where: { productId: id, imageType: "lifestyle" },
    });
    console.log(`${id}  lifestyle count = ${c}`);
  }
  await prisma.$disconnect();
})();
