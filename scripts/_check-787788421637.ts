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

(async () => {
  const p = new PrismaClient();
  const job = await p.scrapeJob.findFirst({
    where: { sourceUrl: { contains: "787788421637" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, sourceUrl: true, createdAt: true, updatedAt: true, product: { select: { id: true, title: true, productType: true, optionNames: true } } },
  });
  if (!job) { console.log("NO JOB FOUND for 787788421637"); await p.$disconnect(); return; }
  console.log(`ScrapeJob: ${job.id}  status=${job.status}  created=${job.createdAt.toISOString().slice(11, 19)}  updated=${job.updatedAt.toISOString().slice(11, 19)}`);
  console.log(`  URL: ${job.sourceUrl}`);
  console.log(`  Product: ${job.product?.id ?? "(none)"} — "${job.product?.title ?? "—"}"`);
  console.log(`  ProductType: ${job.product?.productType ?? "(null)"}  optionNames: ${job.product?.optionNames ?? "(null)"}`);

  if (!job.product) { await p.$disconnect(); return; }
  const PID = job.product.id;

  const variants = await p.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { position: true, title: true, isHidden: true, option1: true, option2: true, price: true },
  });
  const visible = variants.filter((v) => !v.isHidden).length;
  console.log(`  Variants: ${visible}/${variants.length} visible`);
  for (const v of variants) console.log(`    #${v.position}  ${v.isHidden ? "HIDE" : "show"}  "${v.title}" — opt1=${v.option1} opt2=${v.option2} price=${v.price}`);

  const images = await p.productImage.findMany({ where: { productId: PID }, select: { imageType: true, sourceUrl: true } });
  const typeCount: Record<string, number> = {};
  for (const img of images) {
    const t = img.imageType ?? "(source)";
    typeCount[t] = (typeCount[t] ?? 0) + 1;
  }
  console.log(`  Images: ${JSON.stringify(typeCount)}`);
  const aliCount = images.filter((i) => !i.imageType && i.sourceUrl?.includes("alicdn")).length;
  console.log(`  .alicdn originals remaining (any keep): ${aliCount}`);

  // Check if pricingNotes exists
  const prod = await p.product.findUnique({ where: { id: PID }, select: { pricingNotes: true, descriptionHtml: true } });
  console.log(`  pricingNotes: ${prod?.pricingNotes ? "present (" + (prod.pricingNotes.length) + " chars)" : "(null)"}`);
  console.log(`  description: ${prod?.descriptionHtml?.length ?? 0} chars`);

  // Scene overrides file?
  const sceneFile = path.resolve(process.cwd(), "scene-overrides", `${PID}.json`);
  console.log(`  scene-overrides/${PID}.json: ${fs.existsSync(sceneFile) ? "EXISTS" : "missing"}`);
  const heroOverride = path.resolve(process.cwd(), "hero-overrides", `${PID}.json`);
  console.log(`  hero-overrides/${PID}.json: ${fs.existsSync(heroOverride) ? "EXISTS" : "missing"}`);

  await p.$disconnect();
})();
