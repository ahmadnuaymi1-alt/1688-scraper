/**
 * Scene-library scraper — Phase 1 of the lifestyle-scene refactor.
 *
 * Scrapes lifestyle / in-context photographs from three approved lighting
 * sources and saves them to scene-library/sources/{brand}/ with a metadata
 * JSON sidecar per image. White-background studio shots, swatches, diagrams
 * and thumbnails are filtered out heuristically (Phase 2 vision description
 * + Phase 3 filtering catch whatever slips through).
 *
 * This module is entirely standalone — it imports nothing from src/ and
 * touches no existing app code. Run one source at a time so the three can
 * run in parallel:
 *
 *   npx tsx scene-library/scrape.ts --source=dazuma
 *   npx tsx scene-library/scrape.ts --source=vakker
 *   npx tsx scene-library/scrape.ts --source=mod
 *
 * Re-running a source RESUMES: images already saved (matched by content
 * hash and by source image URL) are skipped.
 */
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** Shopify products.json blocks Node's fetch (undici) with 403 but serves
 *  curl fine — so the enumeration calls shell out to curl with this UA. */
const CURL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const execFileAsync = promisify(execFile);
const ROOT = path.resolve("scene-library");

type Brand = "dazuma" | "vakker" | "mod";

/** Source weighting — ~1000 scenes total. mod-lighting was dropped (its
 *  imagery is watermarked at the source), so the 15% mod slot was
 *  re-weighted onto dazuma + vakker: ~82% / ~18%. */
const SOURCES: Record<Brand, { home: string; target: number }> = {
  dazuma: { home: "https://dazuma.us", target: 820 },
  vakker: { home: "https://vakkerlight.com", target: 180 },
  mod: { home: "https://www.mod-lighting.com", target: 150 },
};

/** Cap accepted images per product so the library spans many rooms. */
const MAX_PER_PRODUCT = 3;
const DOWNLOAD_CONCURRENCY = 6;

interface Candidate {
  imageUrl: string;
  productUrl: string;
  title: string;
  productType: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bump(rec: Record<string, number>, key: string) {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** Minimal concurrency limiter. */
function pLimit(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(release);
      };
      if (active < n) run();
      else queue.push(run);
    });
  };
}

async function fetchText(url: string, timeoutMs = 45000, tries = 5): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

async function fetchBuffer(url: string, timeoutMs = 30000, tries = 3): Promise<Buffer> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "image/*,*/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

/** Fetch text via the curl binary — used for Shopify products.json, which
 *  returns 403 to Node's fetch (undici) but 200 to curl. */
async function fetchTextCurl(url: string, tries = 5): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const { stdout } = await execFileAsync(
        "curl",
        ["-s", "-S", "-f", "-m", "45", "--compressed", "-A", CURL_UA, url],
        { maxBuffer: 128 * 1024 * 1024, encoding: "utf8" },
      );
      return stdout;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

/** Strip query string + Shopify size suffix so the same asset dedupes. */
function normalizeImageUrl(u: string): string {
  try {
    const url = new URL(u);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/_(?:\d+)?x(?:\d+)?(?=\.[a-z]+$)/i, "");
    return url.toString().toLowerCase();
  } catch {
    return u.split("?")[0].toLowerCase();
  }
}

interface Classification {
  keep: boolean;
  reason: string;
  width: number;
  height: number;
  format: string;
}

/**
 * Heuristic lifestyle / studio-shot classifier. Conservative — only drops
 * clear studio shots, swatches, diagrams and thumbnails. Borderline images
 * pass through to the Phase 2 vision pass.
 */
async function classifyImage(buf: Buffer): Promise<Classification> {
  let width = 0,
    height = 0,
    format = "jpg";
  try {
    const meta = await sharp(buf).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    format = meta.format === "jpeg" ? "jpg" : (meta.format ?? "jpg");
  } catch {
    return { keep: false, reason: "unreadable", width, height, format };
  }
  if (Math.min(width, height) < 600)
    return { keep: false, reason: "too-small", width, height, format };

  const N = 80;
  let data: Buffer, channels: number;
  try {
    const out = await sharp(buf)
      .flatten({ background: "#ffffff" })
      .resize(N, N, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    channels = out.info.channels;
  } catch {
    return { keep: false, reason: "unreadable", width, height, format };
  }

  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * N + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const isWhite = (r: number, g: number, b: number) => r > 234 && g > 234 && b > 234;

  // Border ring: a near-all-white ring marks a studio / cutout product shot.
  let borderTotal = 0,
    borderWhite = 0;
  for (let x = 0; x < N; x++) {
    for (const y of [0, 1, N - 2, N - 1]) {
      const [r, g, b] = at(x, y);
      borderTotal++;
      if (isWhite(r, g, b)) borderWhite++;
    }
  }
  for (let y = 0; y < N; y++) {
    for (const x of [0, 1, N - 2, N - 1]) {
      const [r, g, b] = at(x, y);
      borderTotal++;
      if (isWhite(r, g, b)) borderWhite++;
    }
  }
  if (borderWhite / borderTotal > 0.85)
    return { keep: false, reason: "white-bg-studio", width, height, format };

  // Very low contrast marks a swatch / blank / flat finish detail.
  let sum = 0,
    sum2 = 0;
  const px = N * N;
  for (let i = 0; i < px; i++) {
    const r = data[i * channels],
      g = data[i * channels + 1],
      b = data[i * channels + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += l;
    sum2 += l * l;
  }
  const mean = sum / px;
  const sd = Math.sqrt(Math.max(0, sum2 / px - mean * mean));
  if (sd < 16) return { keep: false, reason: "flat-uniform", width, height, format };

  return { keep: true, reason: "lifestyle", width, height, format };
}

// ── Source enumerators ─────────────────────────────────────────────────

interface Source {
  productUrls: string[];
  resolve: (productUrl: string) => Promise<Candidate[]>;
}

/** Shopify storefront: paginate /products.json. The enumeration result is
 *  cached to _catalog.json after the first success — products.json is
 *  aggressively rate-limited, so it is hit exactly once per source, ever.
 *  Re-runs (and resumes) read the cache and never touch products.json. */
async function buildShopifySource(home: string, brand: Brand): Promise<Source> {
  const cachePath = path.join(ROOT, "sources", brand, "_catalog.json");
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as {
      products: Array<{ url: string; candidates: Candidate[] }>;
    };
    if (cached.products?.length) {
      console.log(`[${brand}] loaded ${cached.products.length} products from cache`);
      const m = new Map(cached.products.map((p) => [p.url, p.candidates]));
      return { productUrls: [...m.keys()], resolve: async (u) => m.get(u) ?? [] };
    }
  } catch {
    /* no usable cache — enumerate fresh below */
  }

  const byProduct = new Map<string, Candidate[]>();
  for (let page = 1; page <= 200; page++) {
    let products: any[];
    try {
      const txt = await fetchTextCurl(`${home}/products.json?limit=250&page=${page}`);
      products = JSON.parse(txt).products ?? [];
    } catch (e) {
      if (page === 1)
        throw new Error(
          `failed to enumerate ${home}/products.json page 1: ${(e as Error).message}`,
        );
      break; // a later page failing — treat as end of catalog
    }
    if (products.length === 0) break;
    for (const p of products) {
      const productUrl = `${home}/products/${p.handle}`;
      const cands: Candidate[] = (p.images ?? [])
        .map((img: any) => img?.src)
        .filter((s: any): s is string => typeof s === "string")
        .map((src: string) => ({
          imageUrl: src,
          productUrl,
          title: p.title ?? "",
          productType: p.product_type ?? "",
        }));
      if (cands.length) byProduct.set(productUrl, cands);
    }
    console.log(`[${brand}] enum page ${page}: ${byProduct.size} products`);
    if (products.length < 250) break;
    await sleep(5000); // products.json is rate-limited — pace page requests
  }
  await writeFile(
    cachePath,
    JSON.stringify({
      products: [...byProduct.entries()].map(([url, candidates]) => ({
        url,
        candidates,
      })),
    }),
  );
  return {
    productUrls: [...byProduct.keys()],
    resolve: async (u) => byProduct.get(u) ?? [],
  };
}

/** mod-lighting: headless-Shopify Next.js site. Sitemap -> product pages. */
async function buildModSource(): Promise<Source> {
  const sm = await fetchText("https://www.mod-lighting.com/sitemap-0.xml");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const productUrls = locs.filter((l) =>
    /^https:\/\/www\.mod-lighting\.com\/products\/[^/]+$/.test(l),
  );
  const resolve = async (productUrl: string): Promise<Candidate[]> => {
    const html = await fetchText(productUrl, 60000);
    const titleM = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleM ? titleM[1].replace(/\s*[|–-].*$/, "").trim() : "";
    const urls = new Set<string>();
    for (const m of html.matchAll(
      /https?:\/\/cdn\.(?:shopify|sanity)\.[a-z]+\/[A-Za-z0-9._/-]+\.(?:jpg|jpeg|png|webp)/gi,
    )) {
      urls.add(m[0]);
    }
    return [...urls].map((imageUrl) => ({
      imageUrl,
      productUrl,
      title,
      productType: "",
    }));
  };
  return { productUrls, resolve };
}

// ── Resume support ─────────────────────────────────────────────────────

async function loadExisting(dir: string): Promise<{
  hashes: Set<string>;
  urls: Set<string>;
  perProduct: Map<string, number>;
  count: number;
}> {
  const hashes = new Set<string>();
  const urls = new Set<string>();
  const perProduct = new Map<string, number>();
  let count = 0;
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return { hashes, urls, perProduct, count };
  }
  for (const f of files) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      const meta = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      if (meta.content_sha1) hashes.add(meta.content_sha1);
      if (meta.image_url) urls.add(normalizeImageUrl(meta.image_url));
      if (meta.source_url)
        perProduct.set(meta.source_url, (perProduct.get(meta.source_url) ?? 0) + 1);
      count++;
    } catch {
      /* ignore unreadable sidecar */
    }
  }
  return { hashes, urls, perProduct, count };
}

// ── Main ───────────────────────────────────────────────────────────────

/** True when a product is a floor lamp or table lamp — for targeted scraping
 *  with the --floortable flag (used to thicken those thin scene pools). */
function isFloorTable(title: string, productType: string): boolean {
  const t = `${title} ${productType}`.toLowerCase();
  if (
    /落地灯|floor lamp|standing lamp|torchiere|台灯|table lamp|desk lamp|bedside lamp|accent lamp/.test(
      t,
    )
  )
    return true;
  if (
    /\blamp\b/.test(t) &&
    !/ceiling|wall lamp|wall light|pendant|chandelier|吊灯|壁灯|吸顶|outdoor|户外|sconce/.test(t)
  )
    return true;
  return false;
}

async function main() {
  const brand = process.argv
    .find((a) => a.startsWith("--source="))
    ?.split("=")[1] as Brand | undefined;
  if (!brand || !(brand in SOURCES)) {
    console.error("Usage: tsx scene-library/scrape.ts --source=dazuma|vakker|mod");
    process.exit(1);
  }
  const targetArg = process.argv.find((a) => a.startsWith("--target="));
  const target = targetArg ? Number(targetArg.split("=")[1]) : SOURCES[brand].target;
  const floorTableOnly = process.argv.includes("--floortable");

  const dir = path.join(ROOT, "sources", brand);
  await mkdir(dir, { recursive: true });

  const existing = await loadExisting(dir);
  const seenHash = existing.hashes;
  const seenUrl = existing.urls;
  let accepted = existing.count;
  console.log(`[${brand}] target=${target} | resuming with ${accepted} already saved`);
  if (accepted >= target) {
    console.log(`[${brand}] target already met — nothing to do.`);
    return;
  }

  console.log(`[${brand}] enumerating catalog...`);
  const source =
    brand === "mod"
      ? await buildModSource()
      : await buildShopifySource(SOURCES[brand].home, brand);
  console.log(`[${brand}] ${source.productUrls.length} products to scan`);

  const limit = pLimit(DOWNLOAD_CONCURRENCY);
  const dropReasons: Record<string, number> = {};
  let processed = 0;
  let productsScanned = 0;

  for (const productUrl of source.productUrls) {
    if (accepted >= target) break;
    // On a resume / backfill run, skip products already at the per-product
    // cap so new images are drawn from fresh products, not re-scanned ones.
    const alreadyForProduct = existing.perProduct.get(productUrl) ?? 0;
    if (alreadyForProduct >= MAX_PER_PRODUCT) continue;
    productsScanned++;

    let cands: Candidate[];
    try {
      cands = await source.resolve(productUrl);
    } catch {
      bump(dropReasons, "product-fetch-failed");
      continue;
    }

    // --floortable: only scrape floor-lamp / table-lamp product pages.
    if (
      floorTableOnly &&
      cands.length > 0 &&
      !isFloorTable(cands[0].title, cands[0].productType)
    ) {
      continue;
    }

    const fresh = cands.filter((c) => {
      const n = normalizeImageUrl(c.imageUrl);
      if (seenUrl.has(n)) return false;
      seenUrl.add(n);
      return true;
    });

    const results = await Promise.all(
      fresh.map((c) =>
        limit(async () => {
          try {
            const buf = await fetchBuffer(c.imageUrl);
            const hash = createHash("sha1").update(buf).digest("hex");
            const cls = await classifyImage(buf);
            return { c, buf, hash, cls };
          } catch {
            return null;
          }
        }),
      ),
    );

    let perProduct = alreadyForProduct;
    for (const r of results) {
      processed++;
      if (!r) {
        bump(dropReasons, "download-failed");
        continue;
      }
      if (accepted >= target || perProduct >= MAX_PER_PRODUCT) continue;
      if (seenHash.has(r.hash)) {
        bump(dropReasons, "duplicate-content");
        continue;
      }
      if (!r.cls.keep) {
        bump(dropReasons, r.cls.reason);
        continue;
      }
      seenHash.add(r.hash);
      const id = `${brand}-${r.hash.slice(0, 16)}`;
      await writeFile(path.join(dir, `${id}.${r.cls.format}`), r.buf);
      await writeFile(
        path.join(dir, `${id}.json`),
        JSON.stringify(
          {
            image_id: id,
            source_brand: brand,
            source_url: r.c.productUrl,
            image_url: r.c.imageUrl,
            scraped_date: new Date().toISOString(),
            source_title: r.c.title,
            source_product_type: r.c.productType,
            width: r.cls.width,
            height: r.cls.height,
            content_sha1: r.hash,
          },
          null,
          2,
        ),
      );
      accepted++;
      perProduct++;
    }

    if (productsScanned % 20 === 0) {
      console.log(
        `[${brand}] scanned ${productsScanned} products | ${accepted}/${target} accepted | ${processed} images checked`,
      );
    }
  }

  const report = {
    brand,
    target,
    accepted,
    products_scanned: productsScanned,
    images_checked: processed,
    drop_reasons: dropReasons,
    finished_date: new Date().toISOString(),
  };
  await writeFile(path.join(dir, "_report.json"), JSON.stringify(report, null, 2));
  console.log(`[${brand}] DONE — ${accepted}/${target} accepted`);
  console.log(`[${brand}] drop reasons:`, JSON.stringify(dropReasons));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
