/**
 * Agent-mode Step 3 on cmq3uuchk000jw2ckrijd98hq (skeleton mechanical watch).
 * Phase 2 produced 4 clean variants with combined "Case + Dial Color" axis. Split
 * into 2 axes (Case Color × Dial Color) for cleanest customer presentation.
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

const PID = "cmq3uuchk000jw2ckrijd98hq";
const updates = [
  { position: 1, option1: "Black", option2: "Gold",   title: "Black / Gold" },
  { position: 2, option1: "Black", option2: "Silver", title: "Black / Silver" },
  { position: 3, option1: "Silver", option2: "Gold",   title: "Silver / Gold" },
  { position: 4, option1: "Silver", option2: "Silver", title: "Silver / Silver" },
];

(async () => {
  const prisma = new PrismaClient();

  await prisma.product.update({
    where: { id: PID },
    data: { productType: "watch", optionNames: JSON.stringify(["Case Color", "Dial Color"]) },
  });
  console.log(`Product: productType='watch', optionNames=[Case Color, Dial Color]`);

  for (const u of updates) {
    const v = await prisma.variant.findFirst({ where: { productId: PID, position: u.position }, select: { id: true } });
    if (!v) { console.log(`  #${u.position}: not found, skipping`); continue; }
    await prisma.variant.update({
      where: { id: v.id },
      data: { title: u.title, option1: u.option1, option2: u.option2 },
    });
    console.log(`  #${u.position}: ${u.title} (option1=${u.option1}, option2=${u.option2})`);
  }

  console.log("\nFinal state:");
  const after = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { position: true, title: true, option1: true, option2: true, isHidden: true },
  });
  for (const v of after) {
    console.log(`  #${v.position}  ${v.isHidden ? "HIDE" : "show"}  ${v.option1} | ${v.option2}  → "${v.title}"`);
  }
  await prisma.$disconnect();
})();
