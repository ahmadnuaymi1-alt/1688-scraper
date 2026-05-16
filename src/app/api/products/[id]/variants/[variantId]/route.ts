import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

interface VariantPatchBody {
  title?: unknown;
  option1?: unknown;
  option2?: unknown;
  option3?: unknown;
  price?: unknown;
  compareAtPrice?: unknown;
  supplierCost?: unknown;
  sku?: unknown;
  barcode?: unknown;
  weight?: unknown;
  weightUnit?: unknown;
  packagingDimensions?: unknown;
  position?: unknown;
  isHidden?: unknown;
  supplierLabel1?: unknown;
  supplierLabel2?: unknown;
  supplierLabel3?: unknown;
  featuredImageId?: unknown;
}

function pickVariantData(body: VariantPatchBody): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.option1 === "string" || body.option1 === null) data.option1 = body.option1;
  if (typeof body.option2 === "string" || body.option2 === null) data.option2 = body.option2;
  if (typeof body.option3 === "string" || body.option3 === null) data.option3 = body.option3;
  if (typeof body.price === "string") data.price = body.price;
  if (typeof body.compareAtPrice === "string" || body.compareAtPrice === null) {
    data.compareAtPrice = body.compareAtPrice;
  }
  if (typeof body.supplierCost === "string" || body.supplierCost === null) {
    data.supplierCost = body.supplierCost;
  }
  if (typeof body.sku === "string" || body.sku === null) data.sku = body.sku;
  if (typeof body.barcode === "string" || body.barcode === null) data.barcode = body.barcode;
  if (typeof body.weight === "number" || body.weight === null) data.weight = body.weight;
  if (typeof body.weightUnit === "string" || body.weightUnit === null) {
    data.weightUnit = body.weightUnit;
  }
  if (typeof body.packagingDimensions === "string" || body.packagingDimensions === null) {
    data.packagingDimensions = body.packagingDimensions;
  }
  if (typeof body.position === "number") data.position = body.position;
  if (typeof body.isHidden === "boolean") data.isHidden = body.isHidden;
  if (typeof body.supplierLabel1 === "string" || body.supplierLabel1 === null) {
    data.supplierLabel1 = body.supplierLabel1;
  }
  if (typeof body.supplierLabel2 === "string" || body.supplierLabel2 === null) {
    data.supplierLabel2 = body.supplierLabel2;
  }
  if (typeof body.supplierLabel3 === "string" || body.supplierLabel3 === null) {
    data.supplierLabel3 = body.supplierLabel3;
  }
  return data;
}

async function loadAndAuthorize(
  productId: string,
  variantId: string,
  userId: string,
): Promise<
  | { ok: true }
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
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true },
  });
  if (!variant || variant.productId !== productId) {
    return { ok: false, status: 404, error: "Variant not found" };
  }
  return { ok: true };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, variantId } = await params;
  const auth = await loadAndAuthorize(id, variantId, user.id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: VariantPatchBody;
  try {
    body = (await req.json()) as VariantPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = pickVariantData(body);

  // Special-case featuredImageId: validate it points at a ProductImage in
  // THIS product, or is explicitly null.
  if ("featuredImageId" in body) {
    if (body.featuredImageId === null) {
      data.featuredImageId = null;
    } else if (typeof body.featuredImageId === "string") {
      const img = await prisma.productImage.findUnique({
        where: { id: body.featuredImageId },
        select: { productId: true },
      });
      if (!img || img.productId !== id) {
        return NextResponse.json(
          { error: "featuredImageId must reference an image belonging to this product" },
          { status: 400 },
        );
      }
      data.featuredImageId = body.featuredImageId;
    } else {
      return NextResponse.json(
        { error: "featuredImageId must be a string or null" },
        { status: 400 },
      );
    }
  }

  const variant = await prisma.variant.update({
    where: { id: variantId },
    data: data as Parameters<typeof prisma.variant.update>[0]["data"],
  });
  return NextResponse.json({ variant });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, variantId } = await params;
  const auth = await loadAndAuthorize(id, variantId, user.id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await prisma.variant.delete({ where: { id: variantId } });
  return new NextResponse(null, { status: 204 });
}
