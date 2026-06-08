import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { autoFillVariantImages } from "@/services/variant-image-autofill.service";
import { rederiveVariantFeaturedImages } from "@/services/variant-image-rederive.service";

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
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await autoFillVariantImages(id);
    // autofill matches on shared option slots with a low threshold and isn't
    // size-aware, so it can fill a variant with a wrong-size sibling's image.
    // Follow up with the size-aware do-no-harm re-derivation, which corrects any
    // such fill (only ever repointing to a strictly-better finish+size match).
    const rederived = await rederiveVariantFeaturedImages(id, { apply: true });
    return NextResponse.json({
      ok: true,
      filled: result.filled,
      skippedNoMatch: result.skippedNoMatch,
      alreadyFilled: result.alreadyFilled,
      threshold: result.threshold,
      rederived: rederived.changes.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Autofill failed";
    console.error(`[api/products/${id}/autofill-variant-images] error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
