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
  for (const id of ["cmpjsvap800iew2ggixwlxdbn"]) {
    console.log(`\n=== ${id} ===`);
    const p = await prisma.product.findUnique({
      where: { id },
      select: { rawPayload: true },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    const raw = p.rawPayload ? JSON.parse(p.rawPayload) : null;
    if (!raw) { console.log("rawPayload empty"); continue; }
    console.log("Keys:", Object.keys(raw));
    if (raw.variants && Array.isArray(raw.variants)) {
      console.log(`\nrawPayload.variants (${raw.variants.length}):`);
      for (const v of raw.variants.slice(0, 12)) {
        console.log(`  pos=${v.position ?? "?"} option1="${v.option1}" option2="${v.option2}" option3="${v.option3}" title="${v.title?.slice(0, 40)}"`);
      }
    }
    if (raw.optionNames) {
      console.log("rawPayload.optionNames:", raw.optionNames);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
