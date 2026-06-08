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

const PID = "cmq3yc012000jw2a8sm8e0sgg";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PID },
    select: {
      title: true, productType: true, optionNames: true, tags: true, metaDescription: true,
      variants: { select: { id: true, isHidden: true, featuredImageId: true } },
      images: { select: { id: true, imageType: true, sourceUrl: true, keep: true } },
    },
  });
  if (!p) return;
  const visible = p.variants.filter((v) => !v.isHidden);
  const hidden = p.variants.filter((v) => v.isHidden);
  const heroes = p.images.filter((i) => i.imageType === "hero" || i.imageType === "hero-flat");
  const lifestyles = p.images.filter((i) => i.imageType === "lifestyle");
  const closeups = p.images.filter((i) => i.imageType === "closeup" || i.imageType === "lifestyle-closeup" || i.imageType === "front-detail");
  const originals = p.images.filter((i) => {
    if (i.imageType !== null) return false;
    try { const h = new URL(i.sourceUrl).hostname; return h.endsWith(".alicdn.com"); } catch { return false; }
  });
  const visibleWithHero = visible.filter((v) => v.featuredImageId && heroes.some((h) => h.id === v.featuredImageId));
  console.log("TITLE:", p.title);
  console.log("TYPE:", p.productType);
  console.log("OPTIONS:", p.optionNames);
  console.log("VARIANTS visible/total:", visible.length, "/", p.variants.length);
  console.log("HEROES:", heroes.length);
  console.log("LIFESTYLES:", lifestyles.length);
  console.log("CLOSEUPS:", closeups.length);
  console.log("ORIGINALS surviving (.alicdn.com):", originals.length);
  console.log("VISIBLE-WITH-HERO:", visibleWithHero.length, "/", visible.length);
  console.log("TAGS:", p.tags?.slice(0, 200));
  console.log("META:", p.metaDescription?.slice(0, 200));
  await prisma.$disconnect();
}
main().catch(console.error);
