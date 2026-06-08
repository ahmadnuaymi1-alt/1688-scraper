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

const PID = "cmq3uuchk000jw2ckrijd98hq";

(async () => {
  const p = new PrismaClient();
  try {
    const product = await p.product.findUnique({
      where: { id: PID },
      select: {
        id: true, title: true, productType: true, optionNames: true,
        descriptionHtml: true,
        variants: {
          orderBy: { position: "asc" },
          select: { id: true, position: true, title: true, option1: true, option2: true, option3: true, isHidden: true, featuredImageId: true, supplierCost: true, price: true, packagingDimensions: true },
        },
        images: { select: { id: true, imageType: true, variantId: true } },
      },
    });
    if (!product) { console.log("NOT FOUND"); return; }
    console.log("=".repeat(80));
    console.log(`PID=${product.id}`);
    console.log(`Title: ${product.title}`);
    console.log(`ProductType: ${product.productType ?? "(null)"}`);
    console.log(`OptionNames: ${product.optionNames ?? "(null)"}`);
    console.log(`Description length: ${product.descriptionHtml?.length ?? 0}`);
    console.log("=".repeat(80));

    const visible = product.variants.filter((v) => !v.isHidden).length;
    const hidden = product.variants.length - visible;
    console.log(`\nVARIANTS (${product.variants.length} total, ${visible} visible, ${hidden} hidden):`);
    for (const v of product.variants) {
      const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      console.log(`  #${v.position.toString().padStart(2)} ${v.isHidden ? "HIDE" : "show"} [${v.id.slice(-8)}] ${v.title} → ${opts}  fIMG=${v.featuredImageId?.slice(-8) ?? "—"}`);
    }

    const typeCount: Record<string, number> = {};
    for (const img of product.images) {
      const t = img.imageType ?? "(source)";
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    console.log(`\nIMAGES: ${JSON.stringify(typeCount)}`);
  } finally {
    await p.$disconnect();
  }
})();
