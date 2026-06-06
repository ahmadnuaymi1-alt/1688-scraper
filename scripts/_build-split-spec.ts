/**
 * One-off: build the split spec for the jewellery-box parent.
 *   - groups visible variants by layer count parsed from option1
 *   - DROPS the 12 scent-only duplicate variants (option1 contains "scent")
 *   - emits spec.json for _split-product-into-many.ts (keepAxes=[1], "Style")
 *
 * Read-only on the DB; writes .tmp-split/spec.json.
 *
 *   npx tsx scripts/_build-split-spec.ts [parentId]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";

const PID = process.argv[2] || "cmpxvghau000hw260fnktskfz";
const ORDER = [2, 4, 5, 6, 7, 10];

(async () => {
  const variants = await prisma.variant.findMany({
    where: { productId: PID, isHidden: false },
    orderBy: { position: "asc" },
  });

  const groups = new Map<number, { id: string; option1: string }[]>();
  let dropped = 0;
  for (const v of variants) {
    const opt = v.option1 ?? "";
    if (/scent/i.test(opt)) {
      dropped++;
      continue; // drop the scent-only duplicates
    }
    const m = opt.match(/(\d+)\s*-?\s*layer/i);
    if (!m) {
      console.warn(`  ! no layer count in: "${opt}" (${v.id}) — skipped`);
      continue;
    }
    const n = parseInt(m[1], 10);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n)!.push({ id: v.id, option1: opt });
  }

  const spec = {
    keepAxes: [1],
    groups: ORDER.filter((n) => groups.has(n)).map((n) => ({
      titleSuffix: `${n}-Layer`,
      optionNames: ["Style"],
      keepAxes: [1],
      variantIds: groups.get(n)!.map((x) => x.id),
    })),
  };

  const outDir = path.resolve(process.cwd(), ".tmp-split");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "spec.json"), JSON.stringify(spec, null, 2));

  console.log(`Dropped ${dropped} scent-only variants.`);
  console.log(`Groups (${spec.groups.length}):`);
  for (const g of spec.groups) {
    console.log(`  ${g.titleSuffix}: ${g.variantIds.length} variants`);
    for (const id of g.variantIds) {
      const v = groups.get(parseInt(g.titleSuffix, 10))!.find((x) => x.id === id)!;
      console.log(`     - ${v.option1}`);
    }
  }
  const total = spec.groups.reduce((s, g) => s + g.variantIds.length, 0);
  console.log(`Total kept: ${total} (expected 20)`);
  console.log(`\nWrote ${path.join(outDir, "spec.json")}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
