import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { applyGalleryPreset } from "@/services/gallery-preset.service";

/**
 * Bulk apply the gallery preset order, server-side, fire-and-forget.
 *
 * Mirrors rewrite-descriptions: client POSTs { productIds: string[] }, we
 * validate ownership upfront, return 202 immediately, and kick off a SEQUENTIAL
 * detached loop that calls applyGalleryPreset() for each ID. Preset is a quick
 * DB-only transaction (no LLM calls) but sequential keeps pgbouncer happy on
 * large batches and matches the existing bulk-action pattern.
 *
 * Per-product failures log to the server console; the loop moves on.
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

  // Filter to IDs the caller actually owns.
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
    console.log(`[bulk-apply-gallery-preset] starting ${allowed.length} product(s)`);
    let ok = 0;
    let failed = 0;
    for (const id of allowed) {
      try {
        await applyGalleryPreset(id);
        ok++;
        console.log(`[bulk-apply-gallery-preset] ok: ${id}`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bulk-apply-gallery-preset] fail ${id}: ${msg}`);
      }
    }
    console.log(
      `[bulk-apply-gallery-preset] done — ${ok} ok, ${failed} failed (of ${allowed.length})`,
    );
  })();

  return NextResponse.json(
    { status: "queued", count: allowed.length },
    { status: 202 },
  );
}
