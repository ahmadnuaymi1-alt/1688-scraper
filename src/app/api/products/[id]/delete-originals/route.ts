import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Bulk-delete the originally-scraped 1688 gallery images for a product.
 *
 * An "originally-scraped" image is one where:
 *   - imageType is null (no AI generation has touched it), AND
 *   - sourceUrl host ends with `.alicdn.com` (the only original-source CDN
 *     the scraper pulls from today), AND
 *   - keep === false (the user hasn't starred it to preserve)
 *
 * Deletes both the DB row and the Supabase Storage object (best-effort).
 * Heroes, hero-flats, and lifestyle images are never touched.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // We use a raw findMany + filter on host because Prisma can't express
  // "sourceUrl ends with .alicdn.com" cleanly. The list is small per product
  // (typically 5-30 originals).
  const candidates = await prisma.productImage.findMany({
    where: {
      productId: id,
      imageType: null,
      keep: false,
    },
    select: { id: true, sourceUrl: true, storagePath: true },
  });
  const originals = candidates.filter((img) => {
    try {
      const host = new URL(img.sourceUrl).hostname;
      return host.endsWith(".alicdn.com") || host === "alicdn.com";
    } catch {
      return false;
    }
  });
  if (originals.length === 0) {
    return NextResponse.json({ deleted: 0, kept: 0 });
  }

  // Storage cleanup first (best-effort). Group all paths into one supabase
  // remove() call; failures here don't abort the DB delete.
  const paths = originals.map((o) => o.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
      if (url && key) {
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) {
          console.warn(
            `[delete-originals] supabase remove failed (non-fatal): ${error.message}`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[delete-originals] supabase remove threw (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const result = await prisma.productImage.deleteMany({
    where: { id: { in: originals.map((o) => o.id) } },
  });

  // Count how many originals were kept (for the response toast).
  const kept = await prisma.productImage.count({
    where: {
      productId: id,
      imageType: null,
      keep: true,
    },
  });

  return NextResponse.json({ deleted: result.count, kept });
}
