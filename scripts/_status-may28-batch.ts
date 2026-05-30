/**
 * Snapshot of the 5/28 fan-light batch (9 products). For each: job status,
 * pricing state, hero/lifestyle counts, suspicious variant titles
 * ("Design A" / "Style 1" / unnamed sku style values).
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

const URLS = [
  "https://detail.1688.com/offer/793885600974.html",
  "https://detail.1688.com/offer/709437380042.html",
  "https://detail.1688.com/offer/955197107164.html",
  "https://detail.1688.com/offer/894811539961.html",
  "https://detail.1688.com/offer/1015640456275.html",
  "https://detail.1688.com/offer/927740020672.html",
  "https://detail.1688.com/offer/894762015197.html",
  "https://detail.1688.com/offer/1042424968068.html",
  "https://detail.1688.com/offer/829451251914.html",
];

const SUSPICIOUS_RE =
  /^(design\s*[a-z0-9]+|style\s*[a-z0-9]+|model\s*[a-z0-9]+|type\s*[a-z0-9]+|款\s*[a-z0-9一二三四五六七八九十]+|号\s*[a-z0-9]+|sku\s*[a-z0-9]+)$/i;

(async () => {
  for (const url of URLS) {
    const job = await prisma.scrapeJob.findFirst({
      where: { sourceUrl: url },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        product: {
          select: {
            id: true,
            title: true,
            optionNames: true,
            variants: {
              where: { isHidden: false },
              orderBy: { position: "asc" },
              select: {
                position: true,
                title: true,
                option1: true,
                option2: true,
                option3: true,
                price: true,
              },
            },
            images: {
              where: { imageType: { in: ["hero", "hero-flat", "lifestyle"] } },
              select: { imageType: true },
            },
            pricingNotes: true,
          },
        },
      },
    });
    if (!job) {
      console.log(`${url} | NO JOB`);
      continue;
    }
    const p = job.product;
    const heroCount =
      p?.images.filter((i) => i.imageType === "hero" || i.imageType === "hero-flat").length ?? 0;
    const lifestyleCount = p?.images.filter((i) => i.imageType === "lifestyle").length ?? 0;
    const samplePrice = p?.variants[0]?.price ?? null;
    const variantCount = p?.variants.length ?? 0;

    // Detect suspicious option values like "Design A" / "Style 1"
    const susValues: string[] = [];
    if (p) {
      for (const v of p.variants) {
        for (const slot of [v.option1, v.option2, v.option3]) {
          if (slot && SUSPICIOUS_RE.test(slot.trim())) {
            susValues.push(`pos=${v.position} ${slot}`);
          }
        }
      }
    }

    console.log(
      `${url}\n  job=${job.status.padEnd(8)} productId=${p?.id ?? "-"} variants=${variantCount} samplePrice=${samplePrice} heroes=${heroCount} lifestyles=${lifestyleCount}`,
    );
    if (p?.optionNames) console.log(`  optionNames=${p.optionNames}`);
    if (susValues.length > 0) {
      console.log(`  ⚠ SUSPICIOUS VARIANT VALUES: ${susValues.join(", ")}`);
    }
    if (p?.title) console.log(`  title="${p.title.slice(0, 70)}"`);
    if (job.errorMessage) console.log(`  err: ${job.errorMessage.slice(0, 100)}`);
  }
  await prisma.$disconnect();
})();
