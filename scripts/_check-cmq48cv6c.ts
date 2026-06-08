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
    const p = await prisma.product.findUnique({
      where: { id: "cmq48cv6c000jw2p0nju9lm7r" },
      include: { scrapeJob: { select: { status: true } } },
    });
    console.log("productType:", JSON.stringify((p as any)?.productType));
    console.log("status (job):", p?.scrapeJob?.status);
    console.log("tags:", JSON.stringify(p?.tags));
    console.log("\n--- descriptionHtml (spec/dimension portions) ---");
    const html = p?.descriptionHtml ?? "";
    // print lines that mention mm, inch, diameter, thickness, case, dimension
    const text = html.replace(/<[^>]+>/g, "\n");
    for (const line of text.split(/\n+/)) {
      const t = line.trim();
      if (!t) continue;
      if (/mm|inch|"|diameter|thick|case|dimension|width|length|height|band|strap/i.test(t)) {
        console.log("  " + t.slice(0, 120));
      }
    }
    console.log("\n--- descriptionHtml length:", html.length, "chars ---");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
