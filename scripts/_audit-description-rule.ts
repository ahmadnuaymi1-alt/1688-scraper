/**
 * Audit which of the latest N products have had the description RULE applied
 * vs. which still show the raw 1688 image-dump HTML (or an empty body).
 *
 * The rule template (cmp30839w002gw2o4rm24nsc4 "Standard description") emits
 * a known structure: <h2> title, three <p> paragraphs, "What's Included" <ul>,
 * <h3>Benefits</h3>, <h3>Specifications</h3> with a <table>, <h3>FAQ</h3>.
 *
 * Raw 1688 description, by contrast, is an image dump: <div id="offer-template-0">
 * with N <img> tags and no headings/tables.
 *
 *   npx tsx scripts/_audit-description-rule.ts [count]
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

type Verdict = "rule-applied" | "raw-1688-images" | "partial-no-table" | "empty";

interface Row {
  id: string;
  title: string;
  createdAt: Date;
  verdict: Verdict;
  imgCount: number;
  h2Count: number;
  h3Count: number;
  tableCount: number;
  hasSpecs: boolean;
  hasBenefits: boolean;
  hasFAQ: boolean;
  hasWhatsIncluded: boolean;
  length: number;
}

function classify(html: string | null): {
  verdict: Verdict;
  metrics: Omit<Row, "id" | "title" | "createdAt" | "verdict">;
} {
  const desc = (html ?? "").trim();
  const length = desc.length;
  if (length === 0) {
    return {
      verdict: "empty",
      metrics: {
        imgCount: 0,
        h2Count: 0,
        h3Count: 0,
        tableCount: 0,
        hasSpecs: false,
        hasBenefits: false,
        hasFAQ: false,
        hasWhatsIncluded: false,
        length,
      },
    };
  }
  const imgCount = (desc.match(/<img\b/gi) ?? []).length;
  const h2Count = (desc.match(/<h2\b/gi) ?? []).length;
  const h3Count = (desc.match(/<h3\b/gi) ?? []).length;
  const tableCount = (desc.match(/<table\b/gi) ?? []).length;
  const hasSpecs = /<h3[^>]*>\s*Specifications\s*<\/h3>/i.test(desc) || /<h2[^>]*>\s*Specifications\s*<\/h2>/i.test(desc);
  const hasBenefits = /<h3[^>]*>\s*Benefits\s*<\/h3>/i.test(desc) || /<h2[^>]*>\s*Benefits\s*<\/h2>/i.test(desc);
  const hasFAQ = /<h3[^>]*>\s*FAQ\s*<\/h3>/i.test(desc) || /<h2[^>]*>\s*FAQ\s*<\/h2>/i.test(desc);
  const hasWhatsIncluded = /What['’]s\s+Included/i.test(desc);

  // Rule template hallmarks: ≥1 h2, ≥1 h3, a Specifications table, AND has the
  // structured sub-sections. Score-based so we tolerate minor variations.
  const ruleScore =
    (h2Count > 0 ? 1 : 0) +
    (h3Count > 0 ? 1 : 0) +
    (tableCount > 0 ? 1 : 0) +
    (hasSpecs ? 1 : 0) +
    (hasBenefits ? 1 : 0) +
    (hasFAQ ? 1 : 0) +
    (hasWhatsIncluded ? 1 : 0);

  // Raw 1688 hallmark: lots of <img> tags, no headings, no table.
  const rawScore =
    (imgCount >= 3 ? 1 : 0) +
    (h2Count === 0 ? 1 : 0) +
    (h3Count === 0 ? 1 : 0) +
    (tableCount === 0 ? 1 : 0) +
    (/<div id=["']offer-template/i.test(desc) ? 1 : 0);

  let verdict: Verdict;
  if (ruleScore >= 5) {
    verdict = "rule-applied";
  } else if (rawScore >= 4 && ruleScore <= 1) {
    verdict = "raw-1688-images";
  } else {
    verdict = "partial-no-table";
  }

  return {
    verdict,
    metrics: {
      imgCount,
      h2Count,
      h3Count,
      tableCount,
      hasSpecs,
      hasBenefits,
      hasFAQ,
      hasWhatsIncluded,
      length,
    },
  };
}

async function main() {
  const count = Number(process.argv[2]) || 30;
  const prisma = new PrismaClient();
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: count,
    select: { id: true, title: true, createdAt: true, descriptionHtml: true },
  });
  process.stdout.write(`Auditing description rule on ${products.length} most recent products\n\n`);

  const rows: Row[] = products.map((p) => {
    const c = classify(p.descriptionHtml);
    return {
      id: p.id,
      title: p.title,
      createdAt: p.createdAt,
      verdict: c.verdict,
      ...c.metrics,
    };
  });

  // Detail lines, one per product.
  for (const r of rows) {
    const icon =
      r.verdict === "rule-applied"
        ? "✓"
        : r.verdict === "raw-1688-images"
          ? "✗"
          : r.verdict === "empty"
            ? "—"
            : "?";
    process.stdout.write(
      `${icon} ${r.id}  ${r.createdAt.toISOString().slice(0, 16)}  ${r.verdict.padEnd(18)}  imgs=${r.imgCount} h2=${r.h2Count} h3=${r.h3Count} tbl=${r.tableCount} len=${r.length}\n`,
    );
    process.stdout.write(`    "${r.title.slice(0, 80)}"\n`);
  }

  // Summary.
  const buckets: Record<Verdict, Row[]> = {
    "rule-applied": [],
    "raw-1688-images": [],
    "partial-no-table": [],
    empty: [],
  };
  for (const r of rows) buckets[r.verdict].push(r);

  process.stdout.write(`\n=== Summary ===\n`);
  process.stdout.write(`  Rule applied:      ${buckets["rule-applied"].length}\n`);
  process.stdout.write(`  Raw 1688 images:   ${buckets["raw-1688-images"].length}\n`);
  process.stdout.write(`  Partial / unsure:  ${buckets["partial-no-table"].length}\n`);
  process.stdout.write(`  Empty:             ${buckets["empty"].length}\n`);

  if (buckets["raw-1688-images"].length > 0 || buckets["partial-no-table"].length > 0 || buckets["empty"].length > 0) {
    process.stdout.write(`\n=== Products WITHOUT a working description rule output ===\n`);
    for (const r of [...buckets["raw-1688-images"], ...buckets["partial-no-table"], ...buckets["empty"]]) {
      process.stdout.write(`  ${r.id}  [${r.verdict}]  "${r.title.slice(0, 70)}"\n`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
