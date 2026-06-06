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
const TITLES = [
  "Iron Black Fabric Shade Pull Cord",
  "Aluminum Black 86-Type Motion Sensor",
  "Resin Glass Irregular Adjustable Tri-Color",
  "Black Aluminum Three-Beam LED IP65",
  "Natural Marble Round Warm LED Wall Sconce",
  "Aluminum Alloy Sand Black Rectangular Osram",
  "Fabric Acrylic Dual Vertical LED USB-C",
  "Aluminum Linear Warm Light Smart LED Wall Sconce",
  "Plastic Tall Rechargeable LED Ambient Portable",
];
(async () => {
  const p = new PrismaClient();
  console.log(`Latest 15 products + the ones matching screenshot titles:\n`);
  const all = await p.product.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, title: true, createdAt: true, scrapeJob: { select: { createdAt: true } } } });
  for (const t of TITLES) {
    const m = all.find((p) => p.title?.includes(t));
    if (m) console.log(`  ${m.id}  prod_created=${m.createdAt.toISOString().slice(0, 19)}  job_created=${m.scrapeJob?.createdAt.toISOString().slice(0, 19) ?? "—"}  title=${m.title?.slice(0, 60)}`);
    else console.log(`  NOT FOUND: ${t}`);
  }
  console.log(`\nIDs found: ${TITLES.map((t) => all.find((p) => p.title?.includes(t))?.id).filter(Boolean).join(",")}`);
  await p.$disconnect();
})();
