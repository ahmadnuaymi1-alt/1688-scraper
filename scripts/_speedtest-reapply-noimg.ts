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

const PID = "cmq406kfj000jw2kcgbtfugv6";

async function main() {
  const prisma = new PrismaClient();
  await prisma.product.update({ where: { id: PID }, data: { productType: "watch" } });
  await prisma.$disconnect();
  const { reapplyRules } = await import("../src/services/rule.service");
  console.log("reapply (description,title,tags,seo)...");
  await reapplyRules(PID, ["description", "title", "tags", "seo"]);
  console.log("reapply noimg done");
}

main().catch((e) => { console.error(e); process.exit(1); });
