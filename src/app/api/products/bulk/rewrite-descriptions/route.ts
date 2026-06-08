import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { rewriteProductDescription } from "@/services/description-enrichment.service";

/**
 * Bulk rewrite descriptions, server-side, fire-and-forget.
 *
 * Client POSTs { productIds: string[] }. We validate ownership upfront, return
 * 202 immediately, and kick off a SEQUENTIAL detached loop that calls
 * rewriteProductDescription() for each ID. Sequential (not parallel) on
 * purpose — fanning out 50 simultaneous LLM calls would hammer rate limits.
 *
 * The client can navigate freely after the 202 — the loop continues running
 * inside the Node process until completion (or process restart). Failures on
 * individual products log to the server console and the loop moves on.
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

  // Filter to IDs the caller actually owns. Anything missing or owned by
  // someone else is silently dropped — the count returned reflects only what
  // we'll process.
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
    console.log(`[bulk-rewrite-descriptions] starting ${allowed.length} product(s)`);
    let ok = 0;
    let failed = 0;
    for (const id of allowed) {
      try {
        await rewriteProductDescription(id);
        ok++;
        console.log(`[bulk-rewrite-descriptions] ok: ${id}`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bulk-rewrite-descriptions] fail ${id}: ${msg}`);
      }
    }
    console.log(
      `[bulk-rewrite-descriptions] done — ${ok} ok, ${failed} failed (of ${allowed.length})`,
    );
  })();

  return NextResponse.json(
    { status: "queued", count: allowed.length },
    { status: 202 },
  );
}
