import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Bulk-delete gallery images that aren't assigned to a variant — useful for
 * scrubbing the leftover scrape gallery once each variant has its own
 * featured image picked.
 *
 * Target: an image whose
 *   - imageType is null (original / user-uploaded — NOT a hero, hero-flat,
 *     or lifestyle; those are AI-generated and should never be wiped here), AND
 *   - variantId is null (not assigned to any variant), AND
 *   - keep === false (the user hasn't starred it to preserve).
 *
 * Heroes, hero-flats, and lifestyles are untouched regardless of variant
 * assignment. Variant-assigned originals are also untouched.
 *
 * Storage and DB deletion both run; storage failures are non-fatal.
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

  const unassigned = await prisma.productImage.findMany({
    where: {
      productId: id,
      imageType: null,
      variantId: null,
      keep: false,
    },
    select: { id: true, storagePath: true },
  });

  if (unassigned.length === 0) {
    const kept = await prisma.productImage.count({
      where: { productId: id, imageType: null, variantId: null, keep: true },
    });
    return NextResponse.json({ deleted: 0, kept });
  }

  // Storage cleanup (best-effort).
  const paths = unassigned.map((i) => i.storagePath).filter((p): p is string => !!p);
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
            `[delete-unassigned-images] supabase remove failed (non-fatal): ${error.message}`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[delete-unassigned-images] supabase remove threw (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const result = await prisma.productImage.deleteMany({
    where: { id: { in: unassigned.map((i) => i.id) } },
  });

  const kept = await prisma.productImage.count({
    where: { productId: id, imageType: null, variantId: null, keep: true },
  });

  return NextResponse.json({ deleted: result.count, kept });
}
