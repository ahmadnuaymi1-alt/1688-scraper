import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

interface ConnectionPatchBody {
  label?: unknown;
  storeDomain?: unknown;
  accessToken?: unknown;
  isDefault?: unknown;
}

function isValidAccessToken(token: string): boolean {
  return token.startsWith("shpat_") || token.startsWith("shpca_");
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
  const existing = await prisma.shopifyConnection.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ConnectionPatchBody;
  try {
    body = (await req.json()) as ConnectionPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    label?: string;
    storeDomain?: string;
    accessToken?: string;
    isDefault?: boolean;
  } = {};
  if (typeof body.label === "string") data.label = body.label;
  if (typeof body.storeDomain === "string") data.storeDomain = body.storeDomain;
  if (typeof body.accessToken === "string") {
    if (!isValidAccessToken(body.accessToken)) {
      return NextResponse.json(
        { error: "accessToken must start with shpat_ or shpca_" },
        { status: 400 },
      );
    }
    data.accessToken = body.accessToken;
  }
  if (typeof body.isDefault === "boolean") data.isDefault = body.isDefault;

  // If setting as default, unset other defaults first.
  if (data.isDefault === true) {
    await prisma.shopifyConnection.updateMany({
      where: { userId: user.id, isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }

  const connection = await prisma.shopifyConnection.update({ where: { id }, data });
  return NextResponse.json({ connection });
}

export async function DELETE(
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
  const existing = await prisma.shopifyConnection.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // UploadRecord has connectionId without cascade in schema — manually detach
  // by deleting upload records that reference it, or null them out. Schema has
  // a required (non-nullable) connectionId, so we must delete the records.
  await prisma.uploadRecord.deleteMany({ where: { connectionId: id } });
  await prisma.shopifyConnection.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
