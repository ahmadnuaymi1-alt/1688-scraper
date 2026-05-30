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

async function main() {
  const prisma = new PrismaClient();
  for (const id of [
    "cmpjswf6e00njw2ggf8fceqtd",
    "cmpjsvap800iew2ggixwlxdbn",
    "cmpjstyid007tw2ggulv0g8b3",
    "cmpjstlof005zw2ggy9gucyhh",
  ]) {
    console.log(`\n=== ${id} ===`);
    const p = await prisma.product.findUnique({
      where: { id },
      select: { title: true, descriptionHtml: true, productContext: true },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    console.log(`Title: ${p.title.slice(0, 60)}`);
    if (p.productContext) {
      const ctx = JSON.parse(p.productContext);
      console.log(`extractedSpecs (${ctx.extractedSpecs?.length ?? 0}):`);
      if (Array.isArray(ctx.extractedSpecs)) {
        for (const s of ctx.extractedSpecs) console.log(`  ${s.name}: ${s.value}`);
      }
    }
    const desc = (p.descriptionHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`Description (${desc.length} stripped chars):`);
    console.log(`  ${desc.slice(0, 800)}…`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
