import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "upload";
}

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

/**
 * Upload one or more image files to the product's gallery. Accepts
 * multipart/form-data with one or more `files` fields. Each file is
 * validated (image MIME, ≤10MB), uploaded to Supabase, and persisted as a
 * ProductImage row. Returns { created, failed } so the UI can show a
 * partial-success toast.
 */
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const entries = formData.getAll("files");
  const files: File[] = [];
  for (const entry of entries) {
    if (entry instanceof File) files.push(entry);
  }
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided (use "files" field)' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase credentials not configured" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

  const maxPos = await prisma.productImage.aggregate({
    where: { productId: id },
    _max: { position: true },
  });
  let nextPosition = (maxPos._max.position ?? 0) + 1;

  const created: unknown[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const file of files) {
    try {
      if (!file.type.startsWith("image/")) {
        failed.push({ name: file.name, error: "Not an image file" });
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        failed.push({ name: file.name, error: "File exceeds 10 MB limit" });
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const storagePath = `${id}/upload_${Date.now()}_${safeFileName(file.name)}`;
      const upload = await supabase.storage.from(bucket).upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) {
        failed.push({ name: file.name, error: `Storage upload failed: ${upload.error.message}` });
        continue;
      }
      const publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
      const image = await prisma.productImage.create({
        data: {
          productId: id,
          sourceUrl: publicUrl,
          storagePath,
          fileName: file.name,
          position: nextPosition++,
          downloadStatus: "downloaded",
          imageType: null,
          variantId: null,
        },
      });
      created.push(image);
    } catch (err) {
      failed.push({
        name: file.name,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ created, failed });
}
