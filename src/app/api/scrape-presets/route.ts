import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ScrapeOptionsSchema } from "@/types/scrape-options";

interface PresetCreateBody {
  name?: unknown;
  options?: unknown;
  isDefault?: unknown;
}

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const presets = await prisma.scrapeOptionPreset.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ presets });
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PresetCreateBody;
  try {
    body = (await req.json()) as PresetCreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const parsed = ScrapeOptionsSchema.safeParse(body.options);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid options", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const isDefault = typeof body.isDefault === "boolean" ? body.isDefault : false;
  const optionsString = JSON.stringify(parsed.data);

  try {
    const preset = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.scrapeOptionPreset.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.scrapeOptionPreset.create({
        data: {
          userId: user.id,
          name,
          options: optionsString,
          isDefault,
        },
      });
    });
    return NextResponse.json({ preset });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A preset named "${name}" already exists` },
        { status: 409 },
      );
    }
    throw err;
  }
}
