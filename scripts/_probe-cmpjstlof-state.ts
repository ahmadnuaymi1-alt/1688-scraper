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
  const p = await prisma.product.findUnique({
    where: { id: "cmpjstlof005zw2ggy9gucyhh" },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("optionNames:", p.optionNames);
  console.log("Visible variants:");
  for (const v of p.variants) {
    console.log(`  opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}"`);
  }
  // Simulate Check 8's detection
  const optNames = JSON.parse(p.optionNames || "[]");
  const styleIdx = optNames.findIndex((n: string) => /\b(style|model|type|series|sku|item|design|collection)\b/i.test(n.trim()));
  console.log(`styleAxisIdx: ${styleIdx} (axis name: ${optNames[styleIdx] ?? "n/a"})`);
  const opt = ["option1", "option2", "option3"][styleIdx] as "option1" | "option2" | "option3";
  const styleVals = styleIdx >= 0 ? Array.from(new Set(p.variants.map(v => v[opt]).filter((x): x is string => !!x))) : [];
  console.log(`currentStyleValues: [${styleVals.join(", ")}]`);
  // Check existing specs for stale style refs
  const ctx = p.productContext ? JSON.parse(p.productContext) : null;
  if (ctx?.extractedSpecs) {
    console.log("\nExisting spec names with parens:");
    for (const s of ctx.extractedSpecs) {
      const m = (s.name ?? "").match(/\(([^)]+)\)/);
      if (m) console.log(`  "${s.name}" → ref="${m[1]}"`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
