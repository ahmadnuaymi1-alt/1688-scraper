import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ScrapeOptionsSchema } from "@/types/scrape-options";

interface PresetPatchBody {
  name?: unknown;
  options?: unknown;
  isDefault?: unknown;
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
  const existing = await prisma.scrapeOptionPreset.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PresetPatchBody;
  try {
    body = (await req.json()) as PresetPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    name?: string;
    options?: string;
    isDefault?: boolean;
  } = {};

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }
    data.name = trimmed;
  }

  if (body.options !== undefined) {
    const parsed = ScrapeOptionsSchema.safeParse(body.options);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid options", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    data.options = JSON.stringify(parsed.data);
  }

  if (typeof body.isDefault === "boolean") {
    data.isDefault = body.isDefault;
  }

  try {
    const preset = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.scrapeOptionPreset.updateMany({
          where: { userId: user.id, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.scrapeOptionPreset.update({ where: { id }, data });
    });
    return NextResponse.json({ preset });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A preset with that name already exists" },
        { status: 409 },
      );
    }
    throw err;
  }
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
  const existing = await prisma.scrapeOptionPreset.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.scrapeOptionPreset.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
