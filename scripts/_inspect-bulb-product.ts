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

const prisma = new PrismaClient();
(async () => {
  const p = await prisma.product.findUnique({
    where: { id: "cmppv6kdl00rjw2vsnhsp6sqn" },
    select: {
      title: true,
      optionNames: true,
      variants: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          title: true,
          option1: true,
          option2: true,
          option3: true,
          isHidden: true,
        },
      },
    },
  });
  console.log(`title: ${p?.title?.slice(0, 60)}`);
  console.log(`optionNames: ${p?.optionNames}`);
  for (const v of p?.variants ?? []) {
    console.log(
      `  pos=${v.position} ${v.isHidden ? "HIDDEN " : "visible"} title="${v.title}" opts=[${v.option1}|${v.option2}|${v.option3}]`,
    );
  }
  await prisma.$disconnect();
})();
