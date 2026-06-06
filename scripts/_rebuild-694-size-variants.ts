/**
 * Redo product 694503585724 (cmpspbp9700gew24c1kfrcek7) with a Size axis
 * instead of the dropped Power axis. Supplier dimension images confirm
 * three physical sizes (12W and 18W share one length):
 *
 *   18W variant → 300mm = 11.8"
 *   30W variant → 500mm = 19.7"
 *   48W variant → 800mm = 31.5"
 *
 * 12W stays hidden (it's the same length as the 18W variant — just a
 * weaker bulb option that doesn't belong as a customer-facing choice
 * per the minimum-variants philosophy).
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

const prisma = new PrismaClient();
const PRODUCT_ID = "cmpspbp9700gew24c1kfrcek7";

(async () => {
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: { variants: { orderBy: { position: "asc" } } },
  });
  if (!product) {
    console.log("not found");
    return;
  }

  const pos1 = product.variants.find((v) => v.position === 1);
  const pos2 = product.variants.find((v) => v.position === 2);
  const pos3 = product.variants.find((v) => v.position === 3);
  if (!pos1 || !pos2 || !pos3) {
    console.log("missing one of the expected positions (1, 2, 3)");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // pos=1 (was Default Title at $217.50 — the 18W collapse target) → 11.8"
    await tx.variant.update({
      where: { id: pos1.id },
      data: { option1: '11.8"', option2: null, option3: null, title: '11.8"', isHidden: false },
    });
    // pos=2 (30W → 19.7")
    await tx.variant.update({
      where: { id: pos2.id },
      data: { option1: '19.7"', option2: null, option3: null, title: '19.7"', isHidden: false },
    });
    // pos=3 (48W → 31.5")
    await tx.variant.update({
      where: { id: pos3.id },
      data: { option1: '31.5"', option2: null, option3: null, title: '31.5"', isHidden: false },
    });
    // optionNames → ["Size"]
    await tx.product.update({
      where: { id: PRODUCT_ID },
      data: { optionNames: JSON.stringify(["Size"]) },
    });
  });

  // Verify
  const after = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: { variants: { where: { isHidden: false }, orderBy: { position: "asc" } } },
  });
  console.log(`optionNames: ${after?.optionNames}`);
  for (const v of after?.variants ?? []) {
    console.log(
      `  pos=${v.position}  "${v.title}"  [${v.option1}|${v.option2}|${v.option3}]  $${v.price}`,
    );
  }
  await prisma.$disconnect();
})();
