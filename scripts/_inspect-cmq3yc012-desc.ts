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

const PRODUCT_ID = "cmq3yc012000jw2a8sm8e0sgg";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { title: true, descriptionHtml: true, productType: true, optionNames: true },
  });
  if (!p) return;
  console.log("TITLE:", p.title);
  console.log("DESC LEN:", p.descriptionHtml?.length);
  console.log("--- DESC ---");
  console.log(p.descriptionHtml?.slice(0, 4000));
  await prisma.$disconnect();
}
main().catch(console.error);
