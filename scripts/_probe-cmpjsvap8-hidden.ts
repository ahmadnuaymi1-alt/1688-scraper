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

async function main() {
  const prisma = new PrismaClient();
  for (const id of ["cmpjsvap800iew2ggixwlxdbn", "cmpjsug3l00cpw2gg1r25v59u", "cmpjstyid007tw2ggulv0g8b3"]) {
    console.log(`\n=== ${id} ===`);
    const all = await prisma.variant.findMany({
      where: { productId: id },
      orderBy: { position: "asc" },
    });
    console.log(`Total: ${all.length} (visible=${all.filter(v => !v.isHidden).length}, hidden=${all.filter(v => v.isHidden).length})`);
    console.log("VISIBLE:");
    for (const v of all.filter(v => !v.isHidden)) {
      console.log(`  pos=${v.position} id=${v.id.slice(-8)} opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" supplierLabel1="${v.supplierLabel1}" supplierLabel2="${v.supplierLabel2}"`);
    }
    console.log("HIDDEN (first 8):");
    for (const v of all.filter(v => v.isHidden).slice(0, 8)) {
      console.log(`  pos=${v.position} id=${v.id.slice(-8)} opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" supplierLabel1="${v.supplierLabel1}" supplierLabel2="${v.supplierLabel2}"`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
