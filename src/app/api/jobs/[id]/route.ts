import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

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

  const job = await prisma.scrapeJob.findUnique({
    where: { id },
    include: {
      product: {
        include: {
          variants: { orderBy: { position: "asc" } },
          images: { orderBy: { position: "asc" } },
        },
      },
      logs: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.userId && job.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ job });
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

  const job = await prisma.scrapeJob.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.userId && job.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Detach product (if any) so deletion of the job doesn't cascade unexpectedly,
  // then delete logs + job. Product rows survive so the user keeps their work.
  await prisma.product.updateMany({
    where: { scrapeJobId: id },
    data: { scrapeJobId: null },
  });
  await prisma.jobLog.deleteMany({ where: { scrapeJobId: id } });
  await prisma.scrapeJob.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
