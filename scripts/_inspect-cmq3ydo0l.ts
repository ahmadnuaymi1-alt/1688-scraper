/**
 * Inspect product cmq3ydo0l000jw288ns3doet5 — variants, optionNames, productType.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PID = "cmq3ydo0l000jw288ns3doet5";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PID },
    include: {
      variants: {
        orderBy: { position: "asc" },
        include: { featuredImage: { select: { id: true, storagePath: true, sourceUrl: true } } },
      },
    },
  });
  if (!p) {
    console.log("NOT FOUND");
    await prisma.$disconnect();
    return;
  }

  console.log("Title:", p.title);
  console.log("productType:", p.productType);
  console.log("optionNames:", p.optionNames);
  console.log("Total variants:", p.variants.length);
  console.log("Visible:", p.variants.filter((v) => !v.isHidden).length);
  console.log("Hidden:", p.variants.filter((v) => v.isHidden).length);
  console.log("");
  for (const v of p.variants) {
    console.log(
      `  [${v.position}] ${v.isHidden ? "HIDDEN" : "      "} | opt1=${JSON.stringify(v.option1)} opt2=${JSON.stringify(v.option2)} opt3=${JSON.stringify(v.option3)} | featuredImg=${v.featuredImage?.storagePath ?? v.featuredImage?.sourceUrl ?? "NONE"}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
