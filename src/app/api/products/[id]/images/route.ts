import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

interface ImagePatchBody {
  imageId?: unknown;
  position?: unknown;
  altText?: unknown;
  variantId?: unknown;
  fileName?: unknown;
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
  const images = await prisma.productImage.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
  });
  return NextResponse.json({ images });
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

  let body: ImagePatchBody;
  try {
    body = (await req.json()) as ImagePatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const imageId = typeof body.imageId === "string" ? body.imageId : "";
  if (!imageId) {
    return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  }

  const existing = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true },
  });
  if (!existing || existing.productId !== id) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const data: {
    position?: number;
    altText?: string | null;
    variantId?: string | null;
    fileName?: string | null;
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

  const image = await prisma.productImage.update({ where: { id: imageId }, data });
  return NextResponse.json({ image });
}
