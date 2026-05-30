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

const URLS = [
  "https://detail.1688.com/offer/771893724021.html",
  "https://detail.1688.com/offer/1003543099410.html",
  "https://detail.1688.com/offer/844322490652.html",
  "https://detail.1688.com/offer/917516393453.html",
  "https://detail.1688.com/offer/763876736813.html",
  "https://detail.1688.com/offer/660494385149.html",
  "https://detail.1688.com/offer/1030497903865.html",
  "https://detail.1688.com/offer/776948529256.html",
  "https://detail.1688.com/offer/913699979882.html",
  "https://detail.1688.com/offer/1025688663548.html",
  "https://detail.1688.com/offer/974837549074.html",
  "https://detail.1688.com/offer/831198529519.html",
  "https://detail.1688.com/offer/632542663860.html",
  "https://detail.1688.com/offer/920314842787.html",
  "https://detail.1688.com/offer/826220184575.html",
  "https://detail.1688.com/offer/711917970071.html",
];

function isLikelyEnglish(s: string): boolean {
  // Rough check: title is "English" if it has < 5% Chinese characters.
  const cjk = (s.match(/[一-鿿]/g) ?? []).length;
  return cjk / s.length < 0.05;
}

async function main() {
  const prisma = new PrismaClient();
  const rows: Array<{
    url: string;
    jobId: string | null;
    status: string | null;
    productId: string | null;
    title: string | null;
    titleEng: boolean;
    vars: number;
    imgs: number;
    descLen: number;
  }> = [];
  for (const url of URLS) {
    // Find the most-recent job that actually produced a product, even if
    // the job itself was later marked failed by a transient log-write error.
    // Product existence + English title + variants + images is the real
    // success signal, not the job status.
    const job = await prisma.scrapeJob.findFirst({
      where: { sourceUrl: url, product: { isNot: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        product: {
          select: {
            id: true,
            title: true,
            descriptionHtml: true,
            _count: { select: { variants: true, images: true } },
          },
        },
      },
    });
    rows.push({
      url,
      jobId: job?.id ?? null,
      status: job?.status ?? null,
      productId: job?.product?.id ?? null,
      title: job?.product?.title ?? null,
      titleEng: job?.product?.title ? isLikelyEnglish(job.product.title) : false,
      vars: job?.product?._count.variants ?? 0,
      imgs: job?.product?._count.images ?? 0,
      descLen: job?.product?.descriptionHtml?.length ?? 0,
    });
  }

  let allDone = true;
  let pending = 0;
  for (const r of rows) {
    // "Done" = the PRODUCT looks fully built. Ignore the job's own status
    // because transient pool errors can mark it "failed" after the product
    // landed fine. "applying_rules" means the title rule is still running
    // — we want to wait for that to finish translating the Chinese title.
    const done =
      r.productId !== null &&
      r.vars > 0 &&
      r.imgs > 0 &&
      r.titleEng &&
      r.descLen > 0;
    if (!done) {
      allDone = false;
      pending++;
    }
    const flag = done ? "OK  " : "WAIT";
    console.log(
      `${flag} ${r.status?.padEnd(15) ?? "(no job)".padEnd(15)} ` +
        `vars=${String(r.vars).padStart(3)} imgs=${String(r.imgs).padStart(3)} ` +
        `desc=${String(r.descLen).padStart(5)} eng=${r.titleEng ? "Y" : "N"}  ` +
        `${(r.title ?? "(no product)").slice(0, 60)}`,
    );
  }
  console.log(`\n${pending === 0 ? "ALL DONE" : `${pending}/${URLS.length} still pending`}`);
  process.exit(allDone ? 0 : 1);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(2); });
