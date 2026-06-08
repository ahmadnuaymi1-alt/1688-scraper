import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Collapse a product down to a single "Default Title" variant — i.e. turn it
 * into a single-SKU product. We KEEP one variant (the lowest-position one) so
 * its price/sku/weight/compareAt/packaging fields survive as the product's
 * single-SKU data. Options are cleared on that variant, every other variant
 * is deleted, and `Product.optionNames` is set to null.
 *
 * Why keep a variant instead of deleting everything: the inline editor for
 * price/sku/weight/compareAt lives on the variant row, and the existing hero
 * / lifestyle / Shopify-upload pipelines all iterate `product.variants` —
 * preserving one row keeps them all working without per-call special-casing.
 *
 * No body required. Returns { keptVariantId, deletedVariants }.
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
    select: { id: true, userId: true, handle: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const variants = await prisma.variant.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (variants.length === 0) {
    // Idempotent recovery: a 0-variant product means the user collapsed
    // before the "keep one default" pivot landed. Create a Default Title
    // variant so the inline single-SKU editor has somewhere to write.
    const skuPrefix = (product.handle || "PRODUCT")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/-+$/, "")
      .slice(0, 16);
    const created = await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { optionNames: null },
      });
      return tx.variant.create({
        data: {
          productId: id,
          title: "Default Title",
          option1: null,
          option2: null,
          option3: null,
          price: "0.00",
          sku: `${skuPrefix}-01`,
          position: 0,
        },
      });
    });
    return NextResponse.json({
      keptVariantId: created.id,
      deletedVariants: 0,
      initialized: true,
    });
  }

  const [keep, ...rest] = variants;
  const deleteIds = rest.map((v) => v.id);

  await prisma.$transaction([
    // Reset the kept variant to a "Default Title" single-SKU shape.
    prisma.variant.update({
      where: { id: keep.id },
      data: {
        title: "Default Title",
        option1: null,
        option2: null,
        option3: null,
        position: 0,
        isHidden: false,
        supplierLabel1: null,
        supplierLabel2: null,
        supplierLabel3: null,
      },
    }),
    ...(deleteIds.length > 0
      ? [prisma.variant.deleteMany({ where: { id: { in: deleteIds } } })]
      : []),
    prisma.product.update({
      where: { id },
      data: { optionNames: null },
    }),
  ]);

  return NextResponse.json({
    keptVariantId: keep.id,
    deletedVariants: deleteIds.length,
  });
}
