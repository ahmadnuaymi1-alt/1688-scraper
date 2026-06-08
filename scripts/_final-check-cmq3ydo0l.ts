/**
 * Step 10: final sanity check for cmq3ydo0l000jw288ns3doet5.
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
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!p) {
    console.log("NOT FOUND");
    await prisma.$disconnect();
    return;
  }

  const visibleVariants = p.variants.filter((v) => !v.isHidden);
  const hidden = p.variants.length - visibleVariants.length;
  const heroes = p.images.filter((i) => (i.imageType ?? "").startsWith("hero"));
  const lifestyles = p.images.filter((i) => i.imageType === "lifestyle");
  const closeups = p.images.filter(
    (i) => i.imageType === "lifestyle-closeup" || i.imageType === "closeup",
  );
  const originalsSurvived = p.images.filter((i) => {
    if (i.imageType !== null) return false;
    if (!i.sourceUrl) return false;
    try {
      const u = new URL(i.sourceUrl);
      return u.hostname.endsWith(".alicdn.com");
    } catch {
      return false;
    }
  });
  const starred = p.images.filter((i) => i.keep === true);

  console.log("--- FINAL SANITY ---");
  console.log("Title:", p.title);
  console.log("productType:", p.productType);
  console.log("optionNames:", p.optionNames);
  console.log("status:", p.status);
  console.log("");
  console.log(`Variants: visible=${visibleVariants.length}, hidden=${hidden}, total=${p.variants.length}`);
  console.log(`Heroes (imageType startsWith hero): ${heroes.length}`);
  console.log(`Lifestyles: ${lifestyles.length}`);
  console.log(`Closeups: ${closeups.length}`);
  console.log(`Originals (.alicdn.com surviving): ${originalsSurvived.length}`);
  console.log(`Starred (keep=true): ${starred.length}`);
  console.log("");
  console.log("Per-variant heroes:");
  for (const v of visibleVariants) {
    const fid = v.featuredImageId;
    const fimg = fid ? p.images.find((i) => i.id === fid) : null;
    console.log(
      `  [${v.position}] ${v.option1}: $${v.price} | featuredImage=${fimg?.imageType ?? "NONE"} (${fimg?.id ?? "—"})`,
    );
  }
  console.log("");
  console.log("descriptionHtml length:", p.descriptionHtml?.length ?? 0);
  console.log("seoTitle:", p.seoTitle);
  console.log("seoMetaDescription:", p.seoMetaDescription);
  console.log("tags:", p.tags);

  // Check if description mentions correct variant count (6 dial colors)
  const desc = (p.descriptionHtml ?? "").toLowerCase();
  console.log("");
  console.log("Description mentions 'six' or '6':", desc.includes("six dial") || desc.includes("6 dial"));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
