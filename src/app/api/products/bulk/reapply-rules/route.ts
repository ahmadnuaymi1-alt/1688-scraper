import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { reapplyRules, type RuleCategory } from "@/services/rule.service";

const VALID_CATEGORIES: RuleCategory[] = ["title", "description", "tags", "image", "seo"];

/**
 * Bulk reapply transformation rules, server-side, BLOCKING.
 *
 * Client POSTs { productIds, categories? }. Awaits a sequential loop of
 * reapplyRules() calls and responds 200 with { ok, failed, results }.
 * Sequential is on purpose — running 5 categories × N products in parallel
 * would torch LLM rate limits.
 *
 * Was fire-and-forget (202 + void IIFE) but Next.js dev mode kills detached
 * promises during HMR, so updates silently never made it to the DB and the
 * UI had no signal to refresh. Synchronous is the correct shape.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { productIds?: unknown; categories?: unknown };
  try {
    body = (await req.json()) as { productIds?: unknown; categories?: unknown };
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

  let categories: RuleCategory[] | undefined;
  if (Array.isArray(body.categories)) {
    const out: RuleCategory[] = [];
    for (const c of body.categories) {
      if (typeof c !== "string" || !VALID_CATEGORIES.includes(c as RuleCategory)) {
        return NextResponse.json(
          {
            error: `Invalid category "${c}". Expected one of: ${VALID_CATEGORIES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      if (!out.includes(c as RuleCategory)) out.push(c as RuleCategory);
    }
    categories = out;
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

  const label = categories?.length ? categories.join(",") : "all";
  console.log(
    `[bulk-reapply-rules] starting ${allowed.length} product(s) (categories: ${label})`,
  );
  let ok = 0;
  let failed = 0;
  const results: Array<{ productId: string; ok: boolean; error?: string }> = [];
  for (const id of allowed) {
    try {
      await reapplyRules(id, categories);
      ok++;
      results.push({ productId: id, ok: true });
      console.log(`[bulk-reapply-rules] ok: ${id}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ productId: id, ok: false, error: msg });
      console.error(`[bulk-reapply-rules] fail ${id}: ${msg}`);
    }
  }
  console.log(
    `[bulk-reapply-rules] done — ${ok} ok, ${failed} failed (of ${allowed.length})`,
  );

  return NextResponse.json({
    status: "done",
    count: allowed.length,
    ok,
    failed,
    categories: categories ?? "all",
    results,
  });
}
