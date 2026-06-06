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

const PRODUCT_IDS = [
  "cmpspbahc00c6w24cjae7uv6j",
  "cmpspad7h0096w24cnrxdgycr",
  "cmpspa7wm0075w24ccqg9mzbn",
  "cmpsp9wh7004ww24cr1n8oeki",
  "cmpsp9ppg002uw24chlb1gvmx",
  "cmpsp94gm001nw24cpwbzd5o0",
];

const prisma = new PrismaClient();

(async () => {
  let totalRows = 0;
  let contaminationCount = 0;
  const perProductSummary: string[] = [];
  const issues: string[] = [];

  for (const pid of PRODUCT_IDS) {
    const rows = await prisma.productImage.findMany({
      where: { productId: pid, imageType: "lifestyle" },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    totalRows += rows.length;
    console.log(`\n=== ${pid} (${rows.length} lifestyle rows) ===`);

    const expectedPrefix = `lifestyle/${pid}/`;
    let mismatchInThisProduct = 0;

    for (const r of rows) {
      const sp = r.storagePath ?? "";
      const su = (r.sourceUrl ?? "").slice(0, 80);
      const matches = sp.startsWith(expectedPrefix);
      if (!matches) {
        mismatchInThisProduct++;
        contaminationCount++;
        issues.push(
          `CONTAMINATION: product=${pid} rowId=${r.id} storagePath=${sp} (expected prefix ${expectedPrefix})`,
        );
      }
      console.log(
        [
          `productId=${r.productId}`,
          `id=${r.id}`,
          `position=${r.position}`,
          `storagePath=${sp}`,
          `sourceUrl=${su}`,
          `fileName=${r.fileName}`,
          `createdAt=${r.createdAt.toISOString()}`,
          matches ? "OK" : "MISMATCH",
        ].join("\n  "),
      );

      // Sanity: check fileName & sourceUrl for obvious anomalies
      if (!r.fileName) issues.push(`missing fileName: product=${pid} rowId=${r.id}`);
      if (!r.storagePath) issues.push(`missing storagePath: product=${pid} rowId=${r.id}`);
      if (!r.sourceUrl) issues.push(`missing sourceUrl: product=${pid} rowId=${r.id}`);
    }

    const latest = rows[0]?.createdAt.toISOString() ?? "n/a";
    perProductSummary.push(
      `${pid.slice(0, 12)}...: ${rows.length} rows, ${
        mismatchInThisProduct === 0 ? "all" : `${rows.length - mismatchInThisProduct}/${rows.length}`
      } storagePath=lifestyle/${pid.slice(0, 12)}.../, latest createdAt=${latest}`,
    );
  }

  console.log("\n========== SUMMARY ==========");
  console.log(`Total rows examined: ${totalRows}`);
  console.log(`Contamination mismatches: ${contaminationCount}`);
  for (const line of perProductSummary) console.log(line);
  if (issues.length > 0) {
    console.log("\nISSUES:");
    for (const i of issues) console.log(`  - ${i}`);
  }

  await prisma.$disconnect();
})();
