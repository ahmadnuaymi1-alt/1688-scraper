/** Show exact state of a fixed set of job IDs. Read-only. */
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

// The 4 latest-batch 502 jobs, then the 8 older ones the broad query swept in.
const TARGET_502 = [
  "cmpwsnya2001lw28c33a2qgyb", // 1050020297073
  "cmpwsny2o001hw28c35s766lk", // 728611397603
  "cmpwsnxnr0019w28cgl1uoqau", // 913699979882
  "cmpwsnx6v0013w28cceof3xyw", // 946209815671
];
const OLDER = [
  "cmpre6ej600udw22kgj41tp4k",
  "cmpr6pd1p000jw2wo11s5pk24",
  "cmpjss9ip002rw2gg0udueh8l",
  "cmp4db0ps0001w2zojmwrp3w8",
  "cmp46shes00gtw2wgkoe3belz",
  "cmp3vbjtp0009w2wg43v4hlhp",
  "cmp3v78k40001w2wgctz5gewb",
  "cmp30ftef002sw2o417mzwlg5",
];

(async () => {
  const p = new PrismaClient();
  const all = [...TARGET_502, ...OLDER];
  const jobs = await p.scrapeJob.findMany({
    where: { id: { in: all } },
    select: {
      id: true, sourceUrl: true, status: true, errorMessage: true,
      product: { select: { id: true, _count: { select: { variants: true, images: true } } } },
    },
  });
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const show = (label: string, ids: string[]) => {
    console.log(`\n=== ${label} ===`);
    for (const id of ids) {
      const j = byId.get(id);
      if (!j) { console.log(`  ${id}  (NOT FOUND)`); continue; }
      const prod = j.product ? `prod=${j.product.id} v=${j.product._count.variants} i=${j.product._count.images}` : "no-product";
      console.log(`  ${j.status.padEnd(14)} ${prod}  ${j.sourceUrl.slice(0, 55)}`);
      if (j.errorMessage) console.log(`      err: ${j.errorMessage.split("\n")[0].slice(0, 100)}`);
    }
  };
  show("4 TARGET (latest-batch 502s)", TARGET_502);
  show("8 OLDER (swept in by broad query)", OLDER);
  await p.$disconnect();
})();
