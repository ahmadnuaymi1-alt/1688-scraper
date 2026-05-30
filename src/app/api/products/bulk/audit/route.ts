import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { runPostScrapeAudit } from "@/services/post-scrape-audit.service";

/**
 * Bulk post-scrape audit, fire-and-forget. Mirrors the reapply-rules bulk
 * pattern: validate inputs + ownership, return 202, run sequentially in a
 * detached `void async`. Sequential (not parallel) on purpose — each audit's
 * Check 1 fires Claude vision calls, and stacking N products in parallel
 * would torch the Anthropic rate limit.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { productIds?: unknown };
  try {
    body = (await req.json()) as { productIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.productIds)) {
    return NextResponse.json({ error: "productIds must be an array" }, { status: 400 });
  }
  const productIds = body.productIds.filter((id): id is string => typeof id === "string");
  if (productIds.length === 0) {
    return NextResponse.json({ error: "productIds is empty" }, { status: 400 });
  }

  const owned = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, userId: true },
  });
  const allowed = owned
    .filter((p) => !p.userId || p.userId === user.id)
    .map((p) => p.id);
  if (allowed.length === 0) {
    return NextResponse.json(
      { error: "No accessible products in request" },
      { status: 404 },
    );
  }

  void (async () => {
    console.log(`[bulk-audit] starting ${allowed.length} product(s)`);
    let ok = 0;
    let failed = 0;
    let totalFixed = 0;
    let totalFlagged = 0;
    for (const id of allowed) {
      try {
        const r = await runPostScrapeAudit(id, null);
        ok++;
        totalFixed += r.totalFixed;
        totalFlagged += r.totalFlagged;
        console.log(
          `[bulk-audit] ok: ${id} — ${r.totalFixed} fix(es), ${r.totalFlagged} flag(s) in ${r.durationMs}ms`,
        );
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bulk-audit] fail ${id}: ${msg}`);
      }
    }
    console.log(
      `[bulk-audit] done — ${ok} ok, ${failed} failed (of ${allowed.length}). Total ${totalFixed} fix(es), ${totalFlagged} flag(s).`,
    );
  })();

  return NextResponse.json(
    { status: "queued", count: allowed.length },
    { status: 202 },
  );
}
