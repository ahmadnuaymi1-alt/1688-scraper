import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Bulk-set `Product.lifestyleUnitMode` across many products at once. Drives
 * the lifestyle-image generator's per-slot unit-count decision — see
 * `src/services/lifestyle-unit-mix.service.ts`.
 *
 * Body:  { productIds: string[], mode: "auto" | "single" | "multi" }
 * Reply: { status: "ok", updated: number } (200, synchronous — single SQL update)
 */

const LIFESTYLE_UNIT_MODES = ["auto", "single", "multi"] as const;
type LifestyleUnitMode = (typeof LIFESTYLE_UNIT_MODES)[number];
function isLifestyleUnitMode(v: unknown): v is LifestyleUnitMode {
  return typeof v === "string" && (LIFESTYLE_UNIT_MODES as readonly string[]).includes(v);
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { productIds?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as { productIds?: unknown; mode?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.productIds)) {
    return NextResponse.json({ error: "productIds must be an array" }, { status: 400 });
  }
  if (!isLifestyleUnitMode(body.mode)) {
    return NextResponse.json(
      { error: `mode must be one of ${LIFESTYLE_UNIT_MODES.join(", ")}` },
      { status: 400 },
    );
  }
  const productIds = body.productIds.filter((id): id is string => typeof id === "string");
  if (productIds.length === 0) {
    return NextResponse.json({ error: "productIds is empty" }, { status: 400 });
  }

  // Scope to ownership — never write a row owned by another user.
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

  const result = await prisma.product.updateMany({
    where: { id: { in: allowed } },
    data: { lifestyleUnitMode: body.mode },
  });

  return NextResponse.json({ status: "ok", updated: result.count, mode: body.mode });
}
