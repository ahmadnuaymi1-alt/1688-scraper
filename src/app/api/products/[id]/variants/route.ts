import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

interface VariantPatch {
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

interface VariantCreateBody extends VariantPatch {
  // title + price required for create
}

interface VariantPatchBody extends VariantPatch {
  variantId?: unknown;
  updates?: unknown;
}

interface VariantDeleteBody {
  variantId?: unknown;
}

function pickVariantData(body: VariantPatch): Record<string, unknown> {
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
  if (typeof body.featuredImageId === "string" || body.featuredImageId === null) {
    data.featuredImageId = body.featuredImageId;
  }
  return data;
}

async function checkProductOwnership(productId: string, userId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, userId: true },
  });
  if (!product) return { status: 404 as const, error: "Product not found" };
  if (product.userId && product.userId !== userId) {
    return { status: 403 as const, error: "Forbidden" };
  }
  return { status: 200 as const };
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
  const ownership = await checkProductOwnership(id, user.id);
  if (ownership.status !== 200) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status });
  }
  const variants = await prisma.variant.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
  });
  return NextResponse.json({ variants });
}

export async function POST(
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
  const ownership = await checkProductOwnership(id, user.id);
  if (ownership.status !== 200) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status });
  }

  let body: VariantCreateBody;
  try {
    body = (await req.json()) as VariantCreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const price = typeof body.price === "string" ? body.price : "0.00";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Compute next position
  const last = await prisma.variant.findFirst({
    where: { productId: id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const nextPosition =
    typeof body.position === "number" ? body.position : (last?.position ?? 0) + 1;

  const data = pickVariantData(body);
  data.title = title;
  data.price = price;
  data.position = nextPosition;
  data.productId = id;

  const variant = await prisma.variant.create({
    data: data as Parameters<typeof prisma.variant.create>[0]["data"],
  });

  return NextResponse.json({ variant });
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
  const ownership = await checkProductOwnership(id, user.id);
  if (ownership.status !== 200) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status });
  }

  let body: VariantPatchBody;
  try {
    body = (await req.json()) as VariantPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Bulk shape: `{ updates: Array<{ id: string } & VariantPatch> }`
  if (Array.isArray(body.updates)) {
    type Update = { id: string } & VariantPatch;
    const updates = body.updates as unknown[];
    const parsed: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const u of updates) {
      if (!u || typeof u !== "object") continue;
      const obj = u as Record<string, unknown>;
      const variantId = typeof obj.id === "string" ? obj.id : "";
      if (!variantId) {
        return NextResponse.json(
          { error: "Every update must include a string `id`" },
          { status: 400 },
        );
      }
      const data = pickVariantData(obj as VariantPatch);
      parsed.push({ id: variantId, data });
    }
    if (parsed.length === 0) {
      return NextResponse.json({ updated: 0 });
    }
    // Verify every variant belongs to this product.
    const ids = parsed.map((p) => p.id);
    const owned = await prisma.variant.findMany({
      where: { id: { in: ids }, productId: id },
      select: { id: true },
    });
    if (owned.length !== parsed.length) {
      return NextResponse.json(
        { error: "One or more variants not found on this product" },
        { status: 404 },
      );
    }
    // If any update sets featuredImageId, every non-null target must reference
    // a ProductImage on THIS product. Cross-product image leakage is rejected.
    const imageIds = new Set<string>();
    for (const p of parsed) {
      const fid = p.data.featuredImageId;
      if (typeof fid === "string") imageIds.add(fid);
    }
    if (imageIds.size > 0) {
      const ownedImages = await prisma.productImage.findMany({
        where: { id: { in: Array.from(imageIds) }, productId: id },
        select: { id: true },
      });
      if (ownedImages.length !== imageIds.size) {
        return NextResponse.json(
          { error: "featuredImageId must reference an image belonging to this product" },
          { status: 400 },
        );
      }
    }
    await prisma.$transaction(
      parsed.map((p) =>
        prisma.variant.update({
          where: { id: p.id },
          data: p.data as Parameters<typeof prisma.variant.update>[0]["data"],
        }),
      ),
    );
    return NextResponse.json({ updated: parsed.length });
  }

  // Singular shape: `{ variantId, ...VariantPatch }`
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  if (!variantId) {
    return NextResponse.json(
      { error: "Pass either `variantId` (singular) or `updates: []` (bulk)" },
      { status: 400 },
    );
  }

  const existing = await prisma.variant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true },
  });
  if (!existing || existing.productId !== id) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const data = pickVariantData(body);
  const variant = await prisma.variant.update({
    where: { id: variantId },
    data: data as Parameters<typeof prisma.variant.update>[0]["data"],
  });
  return NextResponse.json({ variant });
}

export async function DELETE(
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
  const ownership = await checkProductOwnership(id, user.id);
  if (ownership.status !== 200) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status });
  }

  let body: VariantDeleteBody;
  try {
    body = (await req.json()) as VariantDeleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  if (!variantId) {
    return NextResponse.json({ error: "variantId is required" }, { status: 400 });
  }

  const existing = await prisma.variant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true },
  });
  if (!existing || existing.productId !== id) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }
  await prisma.variant.delete({ where: { id: variantId } });
  return new NextResponse(null, { status: 204 });
}
