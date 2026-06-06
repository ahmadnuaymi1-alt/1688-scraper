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
  const id = "cmpspbp9700gew24c1kfrcek7";
  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: {
        where: { imageType: null },
        select: { position: true, fileName: true, sourceUrl: true, variantId: true, storagePath: true },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!p) {
    console.log("not found");
    return;
  }
  console.log(`Product: ${p.title}`);
  console.log(`optionNames: ${p.optionNames}`);
  console.log(`\nVariants (${p.variants.length} total):`);
  for (const v of p.variants) {
    console.log(
      `  pos=${String(v.position).padStart(2)} ${v.isHidden ? "HIDDEN  " : "visible "} title="${v.title}"  opts=[${v.option1}|${v.option2}|${v.option3}]  price=${v.price}  featuredImage=${v.featuredImageId ?? "—"}`,
    );
  }
  console.log(`\nSource images (${p.images.length} total):`);
  for (const i of p.images.slice(0, 20)) {
    console.log(`  pos=${String(i.position).padStart(2)} fileName=${i.fileName?.slice(0, 70)}  variantId=${i.variantId ?? "—"}`);
  }
  await prisma.$disconnect();
})();
