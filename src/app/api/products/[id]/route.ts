import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { deriveHandle } from "@/lib/handle";

interface ProductPatchBody {
  title?: unknown;
  descriptionHtml?: unknown;
  vendor?: unknown;
  productType?: unknown;
  tags?: unknown;
  metaDescription?: unknown;
  optionNames?: unknown;
  variantOrder?: unknown;
  imageOrder?: unknown;
  lifestyleUnitMode?: unknown;
}

const LIFESTYLE_UNIT_MODES = ["auto", "single", "multi"] as const;
type LifestyleUnitMode = (typeof LIFESTYLE_UNIT_MODES)[number];
function isLifestyleUnitMode(v: unknown): v is LifestyleUnitMode {
  return typeof v === "string" && (LIFESTYLE_UNIT_MODES as readonly string[]).includes(v);
}

export async function GET(
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
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ product });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId && existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ProductPatchBody;
  try {
    body = (await req.json()) as ProductPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    title?: string;
    handle?: string;
    descriptionHtml?: string | null;
    vendor?: string | null;
    productType?: string | null;
    tags?: string | null;
    metaDescription?: string | null;
    optionNames?: string | null;
    lifestyleUnitMode?: string;
  } = {};

  if (typeof body.title === "string") {
    data.title = body.title;
    // Handle tracks title: every title change re-derives the slug so the
    // local handle never drifts from the live title (user's standing rule).
    // The last 8 chars of the productId act as the uniqueness fallback for
    // very short / Chinese-only titles.
    data.handle = deriveHandle(body.title, id.slice(-8));
  }
  if (typeof body.descriptionHtml === "string" || body.descriptionHtml === null) {
    data.descriptionHtml = body.descriptionHtml as string | null;
  }
  if (typeof body.vendor === "string" || body.vendor === null) {
    data.vendor = body.vendor as string | null;
  }
  if (typeof body.productType === "string" || body.productType === null) {
    data.productType = body.productType as string | null;
  }
  if (typeof body.tags === "string" || body.tags === null) {
    data.tags = body.tags as string | null;
  }
  if (typeof body.metaDescription === "string" || body.metaDescription === null) {
    data.metaDescription = body.metaDescription as string | null;
  }
  if (body.lifestyleUnitMode !== undefined) {
    if (!isLifestyleUnitMode(body.lifestyleUnitMode)) {
      return NextResponse.json(
        { error: `lifestyleUnitMode must be one of ${LIFESTYLE_UNIT_MODES.join(", ")}` },
        { status: 400 },
      );
    }
    data.lifestyleUnitMode = body.lifestyleUnitMode;
  }
  if (body.optionNames !== undefined) {
    if (Array.isArray(body.optionNames)) {
      data.optionNames = JSON.stringify(body.optionNames);
    } else if (typeof body.optionNames === "string" || body.optionNames === null) {
      data.optionNames = body.optionNames as string | null;
    }
  }

  // variantOrder: array of variant IDs in the user's desired display order.
  // Every reorder UI (drag-drop, up/down arrows, axis sort, price sort) POSTs
  // this field and expects each variant's `position` to be rewritten 0..N-1
  // accordingly. Previously the API silently dropped the field, so every
  // reorder was a no-op on the DB — sort indicators looked correct in-session
  // but the order reverted on reload.
  const variantOrder = Array.isArray(body.variantOrder)
    ? (body.variantOrder.filter((v) => typeof v === "string") as string[])
    : null;

  // imageOrder: same idea for ProductImage rows (e.g. "Apply preset order"
  // button on the Images section).
  const imageOrder = Array.isArray(body.imageOrder)
    ? (body.imageOrder.filter((v) => typeof v === "string") as string[])
    : null;

  // Build the per-table writes. Run inside a single $transaction so a partial
  // failure can't leave the product half-reordered.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (variantOrder && variantOrder.length > 0) {
    const owned = await prisma.variant.findMany({
      where: { id: { in: variantOrder }, productId: id },
      select: { id: true },
    });
    if (owned.length !== variantOrder.length) {
      return NextResponse.json(
        { error: "variantOrder contains IDs that don't belong to this product" },
        { status: 400 },
      );
    }
    for (let i = 0; i < variantOrder.length; i++) {
      ops.push(
        prisma.variant.update({
          where: { id: variantOrder[i] },
          data: { position: i },
        }),
      );
    }
  }
  if (imageOrder && imageOrder.length > 0) {
    const owned = await prisma.productImage.findMany({
      where: { id: { in: imageOrder }, productId: id },
      select: { id: true },
    });
    if (owned.length !== imageOrder.length) {
      return NextResponse.json(
        { error: "imageOrder contains IDs that don't belong to this product" },
        { status: 400 },
      );
    }
    for (let i = 0; i < imageOrder.length; i++) {
      ops.push(
        prisma.productImage.update({
          where: { id: imageOrder[i] },
          data: { position: i },
        }),
      );
    }
  }

  const updateProduct = prisma.product.update({
    where: { id },
    data,
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });

  // Run the Product field updates + every position write in one transaction.
  const results = await prisma.$transaction([updateProduct, ...ops]);
  const updated = results[0] as Awaited<typeof updateProduct>;

  return NextResponse.json({ product: updated });
}
