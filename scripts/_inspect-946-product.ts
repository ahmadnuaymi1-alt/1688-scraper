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
  const j = await prisma.scrapeJob.findFirst({
    where: { sourceUrl: { contains: "946467767757" } },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: { variants: { orderBy: { position: "asc" } } },
      },
    },
  });
  if (!j?.product) {
    console.log("not found");
    return;
  }
  for (const v of j.product.variants) {
    const hid = v.isHidden ? "HIDDEN" : "      ";
    console.log(
      `pos=${String(v.position).padStart(2)} ${hid} title="${v.title}" opts=[${v.option1}|${v.option2}|${v.option3}]`,
    );
  }
  await prisma.$disconnect();
})();
