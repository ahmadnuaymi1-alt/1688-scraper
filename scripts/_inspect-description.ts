/**
 * Throwaway: inspect descriptionHtml + scrapeJob status for a product.
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
    let v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const id = process.argv[2];
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id },
    include: { scrapeJob: { include: { logs: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!p) { console.log("not found"); process.exit(1); }
  console.log("title:", p.title.slice(0, 80));
  console.log("sourceUrl:", p.scrapeJob?.sourceUrl);
  console.log("scrape status:", p.scrapeJob?.status, "errorMessage:", p.scrapeJob?.errorMessage);
  console.log();
  const html = p.descriptionHtml ?? "";
  console.log("descriptionHtml length:", html.length, "chars");
  console.log("html (first 800 chars):");
  console.log(html.slice(0, 800));
  console.log();
  console.log("html tag breakdown:");
  const tags = (html.match(/<(\w+)/g) || []).reduce((acc, t) => { const k = t.slice(1); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  console.log(tags);
  console.log();
  console.log("text-only (tags stripped):");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log(text.slice(0, 500) || "(empty)");
  console.log();
  if (p.scrapeJob?.logs?.length) {
    console.log(`scrape logs (${p.scrapeJob.logs.length}):`);
    for (const log of p.scrapeJob.logs.slice(-30)) {
      const msg = (log.message ?? "").slice(0, 140);
      console.log(`  [${log.level}] ${msg}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
