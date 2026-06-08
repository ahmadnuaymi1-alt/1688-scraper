/** Print full image URLs for cmq48cyg3. Read-only. */
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
const ID = "cmq48cyg3000jw2g46nf689gj";
async function main() {
  const prisma = new PrismaClient();
  const imgs = await prisma.productImage.findMany({ where: { productId: ID }, orderBy: { position: "asc" } });
  let alicdn = 0;
  for (const im of imgs) {
    let host = "?";
    try { host = new URL(im.sourceUrl).host; } catch {}
    if (host.endsWith(".alicdn.com")) alicdn++;
    console.log(`pos${im.position} ${im.id} | var=${im.variantId ?? "—"} | host=${host}`);
    console.log(`   sourceUrl: ${im.sourceUrl}`);
    console.log(`   storagePath: ${im.storagePath ?? "—"}`);
  }
  console.log("\nalicdn-host count:", alicdn);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
