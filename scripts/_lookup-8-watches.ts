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
const OFFER_IDS = ["699718063541", "818536622952", "1035580546279", "863802150068", "778114667246", "796039720950", "800214526569", "997410629233"];
(async () => {
  const p = new PrismaClient();
  for (const off of OFFER_IDS) {
    const j = await p.scrapeJob.findFirst({
      where: { sourceUrl: { contains: `offer/${off}` } },
      select: { product: { select: { id: true, title: true, variants: { where: { isHidden: false }, select: { id: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    const p2 = j?.product;
    console.log(`${off}  ${p2?.id ?? "—"}  vars=${p2?.variants.length ?? 0}  ${(p2?.title ?? "").slice(0, 55)}`);
  }
  await p.$disconnect();
})();
