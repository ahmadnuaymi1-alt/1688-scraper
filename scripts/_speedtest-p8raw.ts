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
const PID = process.argv[2] ?? "cmq48g609000jw2oo2ubz3vrm";
async function main() {
  const prisma = new PrismaClient();
  const pr: any = await prisma.product.findUnique({ where: { id: PID }, include: { variants: { orderBy: { position: "asc" } } } });
  const rp = typeof pr.rawPayload === "string" ? JSON.parse(pr.rawPayload) : pr.rawPayload;
  const s = JSON.stringify(rp ?? {});
  const urls = [...new Set((s.match(/https?:[^"\\]+?\.(?:jpg|jpeg|png|webp)/gi) || []).filter((u) => u.includes("alicdn")))];
  console.log("rawPayload len:", s.length, "| alicdn image urls:", urls.length);
  urls.slice(0, 10).forEach((u) => console.log("  IMG", u));
  console.log("--- visible variants ---");
  for (const v of pr.variants.filter((v: any) => !v.isHidden)) console.log("  #" + v.position, v.option1, "feat=" + (v.featuredImageId ?? "null"));
  // also check hero-cli ref cache on disk
  const cacheDir = path.join(process.env.TEMP ?? "/tmp", "hero-cli", "refs");
  console.log("hero-cli ref cache:", fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).length + " files" : "none");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
