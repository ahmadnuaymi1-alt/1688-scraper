/**
 * Quick description / dimension snapshot for cmq3ydo0l000jw288ns3doet5.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: "cmq3ydo0l000jw288ns3doet5" },
    select: { id: true, title: true, descriptionHtml: true, productType: true },
  });
  console.log("Title:", p?.title);
  console.log("productType:", p?.productType);
  console.log("Description length:", p?.descriptionHtml?.length ?? 0);
  console.log("---DESCRIPTION---");
  console.log(p?.descriptionHtml);
  console.log("---END---");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
