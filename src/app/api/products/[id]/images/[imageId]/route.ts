import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

interface ImagePatchBody {
  position?: unknown;
  altText?: unknown;
  variantId?: unknown;
  fileName?: unknown;
  keep?: unknown;
}

async function loadAndAuthorize(
  productId: string,
  imageId: string,
  userId: string,
): Promise<
  | { ok: true; storagePath: string | null }
  | { ok: false; status: number; error: string }
> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, userId: true },
  });
  if (!product) return { ok: false, status: 404, error: "Product not found" };
  if (product.userId && product.userId !== userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true, storagePath: true },
  });
  if (!image || image.productId !== productId) {
    return { ok: false, status: 404, error: "Image not found" };
  }
  return { ok: true, storagePath: image.storagePath };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, imageId } = await params;
  const auth = await loadAndAuthorize(id, imageId, user.id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: ImagePatchBody;
  try {
    body = (await req.json()) as ImagePatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    position?: number;
    altText?: string | null;
    variantId?: string | null;
    fileName?: string | null;
    keep?: boolean;
  } = {};

  if (typeof body.position === "number") data.position = body.position;
  if (typeof body.altText === "string" || body.altText === null) {
    data.altText = body.altText as string | null;
  }
  if (typeof body.variantId === "string" || body.variantId === null) {
    data.variantId = body.variantId as string | null;
  }
  if (typeof body.fileName === "string" || body.fileName === null) {
    data.fileName = body.fileName as string | null;
  }
  if (typeof body.keep === "boolean") data.keep = body.keep;

  const image = await prisma.productImage.update({ where: { id: imageId }, data });
  return NextResponse.json({ image });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, imageId } = await params;
  const auth = await loadAndAuthorize(id, imageId, user.id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Best-effort: remove from Supabase Storage if we have credentials + storagePath.
  if (auth.storagePath) {
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
      if (url && key) {
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await supabase.storage.from(bucket).remove([auth.storagePath]);
        if (error) {
          console.warn(
            `[api/products/${id}/images/${imageId}] supabase remove failed: ${error.message}`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[api/products/${id}/images/${imageId}] supabase remove threw:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await prisma.productImage.delete({ where: { id: imageId } });
  return new NextResponse(null, { status: 204 });
}
