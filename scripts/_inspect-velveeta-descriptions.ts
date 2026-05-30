/**
 * Inspect the latest 27 Velveeta uploads + the active description rule —
 * read-only diagnostic. Outputs a per-product preview so we can decide which
 * ones don't match the rule format.
 *
 *   npx tsx scripts/_inspect-velveeta-descriptions.ts
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

async function main() {
  const prisma = new PrismaClient();
  try {
    const all = await prisma.shopifyConnection.findMany({
      select: { id: true, label: true, storeDomain: true },
    });
    const velveeta =
      all.find((c) => /elveeta|ilvida/i.test(c.label)) ??
      (all.length === 1 ? all[0] : null);
    if (!velveeta) {
      console.error("Could not pick a connection. All:");
      for (const c of all) console.error(`  - ${c.label} (${c.storeDomain})`);
      process.exit(1);
    }
    console.log(`Connection: ${velveeta.label} (${velveeta.storeDomain})`);

    const descRules = await prisma.transformationRule.findMany({
      where: { category: "description" },
      orderBy: { updatedAt: "desc" },
    });
    console.log(`\nDescription rules: ${descRules.length}`);
    for (const r of descRules) {
      console.log(`  - "${r.name}"  enabled=${r.enabled}  updated=${r.updatedAt.toISOString()}`);
      try {
        const parsed = JSON.parse(r.config);
        console.log(`    config keys: ${Object.keys(parsed).join(", ")}`);
        const previewBlob = JSON.stringify(parsed).slice(0, 500);
        console.log(`    config preview: ${previewBlob}`);
      } catch {
        console.log(`    config (raw, first 500): ${r.config.slice(0, 500)}`);
      }
    }

    const uploads = await prisma.uploadRecord.findMany({
      where: { connectionId: velveeta.id, status: "success" },
      orderBy: { createdAt: "desc" },
      take: 27,
      include: {
        product: { select: { id: true, title: true, descriptionHtml: true } },
      },
    });
    console.log(`\nLatest ${uploads.length} successful uploads:`);

    function previewDesc(desc: string | null): { len: number; head: string; hasCJK: boolean } {
      const len = desc?.length ?? 0;
      const head = (desc ?? "").slice(0, 220).replace(/\s+/g, " ");
      const hasCJK = /[一-鿿]/.test(desc ?? "");
      return { len, head, hasCJK };
    }

    for (const u of uploads) {
      const p = previewDesc(u.product.descriptionHtml);
      console.log(
        `\n[${u.product.id}] "${u.product.title.slice(0, 70)}"`,
      );
      console.log(`  desc length=${p.len}  hasCJK=${p.hasCJK}`);
      console.log(`  preview: ${p.head}${p.len > 220 ? "…" : ""}`);
    }

    console.log(`\nDone — ${uploads.length} products inspected.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
