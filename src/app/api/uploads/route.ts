import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadProductToShopify } from "@/services/uploader.service";
import { ScrapeOptionsSchema } from "@/types/scrape-options";

interface UploadBody {
  productId?: unknown;
  connectionId?: unknown;
  options?: unknown;
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: UploadBody;
  try {
    body = (await req.json()) as UploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const productId = typeof body.productId === "string" ? body.productId : "";
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
  if (!productId || !connectionId) {
    return NextResponse.json(
      { error: "productId and connectionId are required" },
      { status: 400 },
    );
  }

  // Ownership checks
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, userId: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, userId: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userId && connection.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let parsedOptions;
  if (body.options !== undefined && body.options !== null) {
    try {
      parsedOptions = ScrapeOptionsSchema.parse(body.options);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid options";
      return NextResponse.json({ error: `Invalid options: ${message}` }, { status: 400 });
    }
  }

  try {
    const record = await uploadProductToShopify(productId, connectionId, parsedOptions);
    return NextResponse.json({ upload: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload error";
    console.error(`[api/uploads] error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId") || "";
  if (!productId) {
    return NextResponse.json({ error: "productId query param is required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, userId: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const uploads = await prisma.uploadRecord.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    include: {
      connection: { select: { id: true, label: true, storeDomain: true } },
    },
  });
  return NextResponse.json({ uploads });
}
