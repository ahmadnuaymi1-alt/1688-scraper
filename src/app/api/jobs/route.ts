import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueueScrapeJob } from "@/lib/jobs/queue";
import { ScrapeOptionsSchema } from "@/types/scrape-options";

interface CreateJobsBody {
  urls?: unknown;
  options?: unknown;
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateJobsBody;
  try {
    body = (await req.json()) as CreateJobsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls must be a non-empty array" }, { status: 400 });
  }

  const urls: string[] = [];
  for (const u of body.urls) {
    if (typeof u !== "string" || !u.trim()) {
      return NextResponse.json({ error: "All urls must be non-empty strings" }, { status: 400 });
    }
    urls.push(u.trim());
  }

  let optionsJson: string | undefined;
  if (body.options !== undefined && body.options !== null) {
    try {
      const parsed = ScrapeOptionsSchema.parse(body.options);
      optionsJson = JSON.stringify(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid options";
      return NextResponse.json({ error: `Invalid options: ${message}` }, { status: 400 });
    }
  }

  const jobs: Array<{ id: string; sourceUrl: string; status: string }> = [];
  for (const url of urls) {
    const id = await enqueueScrapeJob(url, optionsJson, user.id);
    jobs.push({ id, sourceUrl: url, status: "queued" });
  }

  return NextResponse.json({ jobs });
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const limitRaw = parseInt(searchParams.get("limit") || "50", 10);
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const where: { userId: string; status?: string } = { userId: user.id };
  if (status) where.status = status;

  const [jobs, total] = await Promise.all([
    prisma.scrapeJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
      include: {
        product: { select: { id: true, title: true, handle: true } },
      },
    }),
    prisma.scrapeJob.count({ where }),
  ]);

  return NextResponse.json({ jobs, total, page, limit });
}
