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
  const jobs = await prisma.scrapeJob.findMany({
    where: { product: { isNot: null } },
    orderBy: { createdAt: "desc" },
    take: 13,
    include: {
      product: {
        select: {
          id: true,
          title: true,
          optionNames: true,
          descriptionHtml: true,
          productContext: true,
          variants: {
            where: { isHidden: false },
            select: { option1: true, option2: true, option3: true, compareAtPrice: true },
          },
        },
      },
    },
  });

  console.log(`Product`.padEnd(28), `OptNames`.padEnd(32), `Vis`, `Cmp`, `DescLen`, `DescImg`, `DupVar`, `WaffleLeft`);
  console.log(`-`.repeat(140));

  for (const j of jobs) {
    const p = j.product!;
    const optNames = p.optionNames ? JSON.parse(p.optionNames).join(",") : "";
    const html = p.descriptionHtml ?? "";
    const imgCount = (html.match(/<img/gi) ?? []).length;
    const compareCount = p.variants.filter((v) => v.compareAtPrice).length;
    // Detect actual duplicate variants (same opt1+opt2+opt3)
    const seen = new Set<string>();
    let dups = 0;
    for (const v of p.variants) {
      const key = `${v.option1}||${v.option2}||${v.option3}`;
      if (seen.has(key)) dups++;
      else seen.add(key);
    }
    // Waffle SKUs still present?
    const wafflePatterns = [
      /^[A-Z]{2,4}[\-_]?\d+[A-Z]?$/,
      /^model\s*\d+/i,
      /^(wybd|jk|hl|wb|nx)[\-\d]+/i,
    ];
    let waffleLeft = 0;
    for (const v of p.variants) {
      for (const val of [v.option1, v.option2, v.option3]) {
        if (val && wafflePatterns.some((re) => re.test(val.trim()))) {
          waffleLeft++;
          break;
        }
      }
    }
    console.log(
      p.id.slice(-28).padEnd(28),
      optNames.padEnd(32),
      String(p.variants.length).padEnd(3),
      String(compareCount).padEnd(3),
      String(html.length).padEnd(7),
      String(imgCount).padEnd(7),
      String(dups).padEnd(6),
      String(waffleLeft).padEnd(10),
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
