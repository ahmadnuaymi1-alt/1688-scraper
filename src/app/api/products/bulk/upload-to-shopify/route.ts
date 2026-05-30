import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { uploadProductToShopify } from "@/services/uploader.service";

// 5 min — enough for a dozen-product bulk. Local dev is unbounded; only
// Vercel honours this. Each upload is sequential and typically ~20-40s.
export const maxDuration = 300;

/**
 * Bulk upload to Shopify, server-side, BLOCKING.
 *
 * Client POSTs { productIds, connectionId? }. Connection resolution:
 *   - explicit `connectionId` wins,
 *   - else the caller's isDefault connection,
 *   - else if exactly one connection exists, use it,
 *   - else 400 (multiple available, none default → user must pick).
 *
 * Awaits every upload before responding 200 with `{ ok, failed, results }`.
 * Was fire-and-forget (returned 202 + `void (async () => …)()`) but Next.js
 * dev mode kills detached promises during HMR / recompile, so uploads
 * silently died mid-flight. Sequential loop respects Shopify rate limits.
 * Each product's UploadRecord is still created by uploadProductToShopify
 * itself, so users can inspect history per-product on the review page.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { productIds?: unknown; connectionId?: unknown };
  try {
    body = (await req.json()) as { productIds?: unknown; connectionId?: unknown };
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

  // Resolve connection
  let connectionId: string | null =
    typeof body.connectionId === "string" ? body.connectionId : null;
  if (!connectionId) {
    const all = await prisma.shopifyConnection.findMany({
      where: { userId: user.id },
      select: { id: true, isDefault: true },
    });
    const def = all.find((c) => c.isDefault);
    if (def) connectionId = def.id;
    else if (all.length === 1) connectionId = all[0].id;
    else if (all.length === 0) {
      return NextResponse.json(
        { error: "No Shopify connections. Add one in Settings first." },
        { status: 400 },
      );
    } else {
      return NextResponse.json(
        { error: "Multiple connections — pick one and pass connectionId." },
        { status: 400 },
      );
    }
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, userId: true, label: true, storeDomain: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.userId && connection.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify product ownership; silently drop anything missing or not owned.
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

  const cid = connectionId;
  const label = connection.label;
  const storeDomain = connection.storeDomain;
  console.log(
    `[bulk-upload-to-shopify] starting ${allowed.length} product(s) → ${label} (${storeDomain})`,
  );
  let ok = 0;
  let failed = 0;
  const results: Array<{ productId: string; ok: boolean; error?: string }> = [];
  for (const id of allowed) {
    try {
      await uploadProductToShopify(id, cid);
      ok++;
      results.push({ productId: id, ok: true });
      console.log(`[bulk-upload-to-shopify] ok: ${id}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ productId: id, ok: false, error: msg });
      console.error(`[bulk-upload-to-shopify] fail ${id}: ${msg}`);
    }
  }
  console.log(
    `[bulk-upload-to-shopify] done — ${ok} ok, ${failed} failed (of ${allowed.length})`,
  );

  return NextResponse.json({
    status: "done",
    count: allowed.length,
    ok,
    failed,
    connectionId: cid,
    connectionLabel: label,
    results,
  });
}
