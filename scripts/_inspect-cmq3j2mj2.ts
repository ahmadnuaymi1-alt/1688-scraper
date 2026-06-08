/* Inspect product cmq3j2mj20032w2p8arpaf42z */
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

const PID = "cmq3j2mj20032w2p8arpaf42z";

(async () => {
  const p = new PrismaClient();
  const product = await p.product.findUnique({ where: { id: PID }, select: { id: true, title: true, productType: true, optionNames: true, pricingNotes: true } });
  console.log("=== PRODUCT ===");
  console.log(JSON.stringify(product, null, 2).slice(0, 800));

  const variants = await p.variant.findMany({
    where: { productId: PID },
    select: { id: true, title: true, position: true, isHidden: true, price: true, featuredImageId: true, option1: true, option2: true },
    orderBy: { position: "asc" },
  });
  console.log("\n=== VARIANTS ===");
  for (const v of variants) {
    console.log(`#${v.position}\thidden=${v.isHidden}\t$${v.price}\tfeat=${v.featuredImageId?.slice(-6) ?? "—"}\toption1=${v.option1}\toption2=${v.option2}\t${v.title}`);
  }

  const images = await p.productImage.findMany({
    where: { productId: PID },
    select: { id: true, sourceUrl: true, imageType: true, position: true, keep: true },
    orderBy: { position: "asc" },
  });
  console.log("\n=== IMAGES ===");
  const byType = new Map<string, number>();
  for (const img of images) {
    const t = img.imageType ?? "(source)";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  for (const [t, n] of byType.entries()) console.log(`  ${t}: ${n}`);
  console.log("\n=== ALICDN COUNT ===");
  const ali = images.filter((i) => i.sourceUrl?.includes(".alicdn.com"));
  console.log(`  ${ali.length} .alicdn`);
  console.log("\n=== HERO IMAGES + their attached variants ===");
  const heroes = images.filter((i) => i.imageType === "hero" || i.imageType === "hero-flat");
  for (const h of heroes) {
    const linked = variants.filter((v) => v.featuredImageId === h.id);
    console.log(`  hero ${h.id.slice(-6)} type=${h.imageType} -> ${linked.map((v) => `#${v.position} ${v.title}`).join(" | ") || "(no variant)"}`);
    console.log(`    src=${h.sourceUrl}`);
  }

  console.log("\n=== VARIANTS WITHOUT HEROES (visible only) ===");
  const heroIds = new Set(heroes.map((h) => h.id));
  for (const v of variants.filter((v) => !v.isHidden)) {
    if (!v.featuredImageId || !heroIds.has(v.featuredImageId)) {
      console.log(`  #${v.position} ${v.title} (featuredImageId=${v.featuredImageId?.slice(-6) ?? "—"})`);
      // print source image
      const src = images.find((i) => i.id === v.featuredImageId);
      if (src) console.log(`    src=${src.sourceUrl} (type=${src.imageType ?? "source"})`);
    }
  }

  await p.$disconnect();
})();
