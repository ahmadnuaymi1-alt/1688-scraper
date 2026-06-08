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

(async () => {
  const p = new PrismaClient();
  const r = await p.product.findUnique({
    where: { id: "cmq3uuchk000jw2ckrijd98hq" },
    select: { descriptionHtml: true, metaDescription: true, tags: true },
  });
  console.log("META:", r?.metaDescription);
  console.log("TAGS:", r?.tags);
  console.log("---DESC---");
  console.log((r?.descriptionHtml ?? "").slice(0, 3500));
  await p.$disconnect();
})();
