/**
 * Image downloader for 1688 scraper.
 *
 * Downloads image URLs (alicdn / itemcdn) to Supabase Storage and persists
 * ProductImage rows via Prisma. For each ScrapedImage:
 *   1. fetch the original bytes (handling protocol-relative `//cbu01…` URLs)
 *   2. detect dimensions with sharp (best-effort — failures are non-fatal)
 *   3. upload to Supabase Storage under `{productId}/{fileName}`
 *   4. create a ProductImage row with downloadStatus = "downloaded" | "failed"
 *
 * Env vars (read at call time, not module load):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_STORAGE_BUCKET (default: "product-images")
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { ProductImage } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ScrapedImage } from "@/types/product";

const DOWNLOAD_TIMEOUT_MS = 30_000;
const CONCURRENCY = 10;

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to download images.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getBucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || "product-images";
}

/**
 * Download every image in `images` to Supabase Storage and persist a
 * ProductImage row per item. Returns the persisted rows in source order.
 * Failed downloads are still persisted with downloadStatus = "failed" so the
 * pipeline can surface them in the UI.
 */
export async function downloadImagesToSupabase(
  images: ScrapedImage[],
  productId: string,
  variantIdBySourceId?: Map<string, string>,
): Promise<ProductImage[]> {
  if (images.length === 0) return [];

  const supabase = getSupabaseClient();
  const bucket = getBucketName();

  const results: ProductImage[] = new Array(images.length);

  for (let offset = 0; offset < images.length; offset += CONCURRENCY) {
    const batch = images.slice(offset, offset + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((img, idx) =>
        downloadSingleImage(supabase, bucket, productId, img, offset + idx, variantIdBySourceId),
      ),
    );
    for (let i = 0; i < batchResults.length; i++) {
      results[offset + i] = batchResults[i];
    }
  }

  return results;
}

interface DownloadOutcome {
  buffer: Buffer | null;
  contentType: string;
  errorMessage: string | null;
  width: number | null;
  height: number | null;
}

async function downloadSingleImage(
  supabase: SupabaseClient,
  bucket: string,
  productId: string,
  image: ScrapedImage,
  index: number,
  variantIdBySourceId?: Map<string, string>,
): Promise<ProductImage> {
  const url = normalizeUrl(image.sourceUrl);
  const fileName = deriveFileName(image, url, index);
  const storagePath = `${productId}/${fileName}`;

  const outcome = await fetchAndProbe(url);

  if (!outcome.buffer) {
    return prisma.productImage.create({
      data: {
        productId,
        sourceUrl: image.sourceUrl,
        altText: image.altText ?? null,
        position: image.position,
        downloadStatus: "failed",
        variantId: image.variantSourceId
          ? (variantIdBySourceId?.get(image.variantSourceId) ?? null)
          : null,
      },
    });
  }

  const { error: uploadError } = await supabase.storage.from(bucket).upload(
    storagePath,
    outcome.buffer,
    {
      contentType: outcome.contentType,
      upsert: true,
    },
  );

  if (uploadError) {
    return prisma.productImage.create({
      data: {
        productId,
        sourceUrl: image.sourceUrl,
        fileName,
        altText: image.altText ?? null,
        position: image.position,
        width: outcome.width ?? image.width ?? null,
        height: outcome.height ?? image.height ?? null,
        downloadStatus: "failed",
        variantId: image.variantSourceId
          ? (variantIdBySourceId?.get(image.variantSourceId) ?? null)
          : null,
      },
    });
  }

  return prisma.productImage.create({
    data: {
      productId,
      sourceUrl: image.sourceUrl,
      storagePath,
      fileName,
      altText: image.altText ?? null,
      position: image.position,
      width: outcome.width ?? image.width ?? null,
      height: outcome.height ?? image.height ?? null,
      downloadStatus: "downloaded",
      variantId: image.variantSourceId
        ? (variantIdBySourceId?.get(image.variantSourceId) ?? null)
        : null,
    },
  });
}

async function fetchAndProbe(url: string): Promise<DownloadOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      buffer: null,
      contentType: "application/octet-stream",
      errorMessage: err instanceof Error ? err.message : String(err),
      width: null,
      height: null,
    };
  }

  if (!response.ok) {
    return {
      buffer: null,
      contentType: "application/octet-stream",
      errorMessage: `HTTP ${response.status}: ${response.statusText}`,
      width: null,
      height: null,
    };
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(buffer).metadata();
    if (typeof meta.width === "number" && meta.width > 0) width = meta.width;
    if (typeof meta.height === "number" && meta.height > 0) height = meta.height;
  } catch {
    // sharp failure is non-fatal — we still upload the bytes.
  }

  return {
    buffer,
    contentType,
    errorMessage: null,
    width,
    height,
  };
}

function normalizeUrl(sourceUrl: string): string {
  if (sourceUrl.startsWith("//")) return `https:${sourceUrl}`;
  return sourceUrl;
}

function deriveFileName(image: ScrapedImage, url: string, index: number): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/");
    const lastPart = parts[parts.length - 1]?.split("?")[0];
    if (lastPart && lastPart.includes(".")) {
      return sanitizeFileName(lastPart);
    }
  } catch {
    // fall through to default
  }
  return `image-${image.position || index + 1}.jpg`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
