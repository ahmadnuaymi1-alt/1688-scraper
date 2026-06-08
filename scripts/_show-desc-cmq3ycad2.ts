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

const PID = "cmq3ycad2000jw2tovgytqkld";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PID },
    select: { descriptionHtml: true, variants: { select: { packagingDimensions: true, option1: true } } },
  });
  console.log("=== DESCRIPTION HTML ===");
  console.log(p?.descriptionHtml ?? "(none)");
  console.log("\n=== VARIANT DIMENSIONS ===");
  for (const v of p?.variants ?? []) {
    console.log(`  ${v.option1}: ${v.packagingDimensions ?? "(none)"}`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
