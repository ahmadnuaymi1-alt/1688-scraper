import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Bulk-delete originals across multiple products. Mirrors the per-product
 * delete-originals endpoint logic, looped sequentially. Fire-and-forget
 * 202 response, same pattern as the other /bulk/* endpoints.
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
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
    const supabase = url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

    let totalDeleted = 0;
    let totalKept = 0;
    let failedProducts = 0;
    for (const pid of allowed) {
      try {
        const candidates = await prisma.productImage.findMany({
          where: {
            productId: pid,
            imageType: null,
            keep: false,
          },
          select: { id: true, sourceUrl: true, storagePath: true },
        });
        const originals = candidates.filter((img) => {
          try {
            const host = new URL(img.sourceUrl).hostname;
            return host.endsWith(".alicdn.com") || host === "alicdn.com";
          } catch {
            return false;
          }
        });
        if (originals.length === 0) continue;
        const paths = originals
          .map((o) => o.storagePath)
          .filter((p): p is string => !!p);
        if (paths.length > 0 && supabase) {
          try {
            const { error } = await supabase.storage.from(bucket).remove(paths);
            if (error) {
              console.warn(`[bulk-delete-originals] ${pid} supabase remove: ${error.message}`);
            }
          } catch (err) {
            console.warn(
              `[bulk-delete-originals] ${pid} supabase remove threw:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
        const r = await prisma.productImage.deleteMany({
          where: { id: { in: originals.map((o) => o.id) } },
        });
        totalDeleted += r.count;
        const kept = await prisma.productImage.count({
          where: {
            productId: pid,
            imageType: null,
            keep: true,
          },
        });
        totalKept += kept;
        console.log(`[bulk-delete-originals] ${pid} — deleted ${r.count}, kept ${kept}`);
      } catch (err) {
        failedProducts++;
        console.error(
          `[bulk-delete-originals] ${pid} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `[bulk-delete-originals] done — ${totalDeleted} image(s) deleted across ${allowed.length} product(s); ${totalKept} kept; ${failedProducts} products failed`,
    );
  })();

  return NextResponse.json(
    { status: "queued", count: allowed.length },
    { status: 202 },
  );
}
