import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { runPostScrapeAudit } from "@/services/post-scrape-audit.service";

/**
 * Per-product post-scrape audit. Mirrors the reapply-rules trigger pattern:
 * sync 202-style response that returns the aggregate audit result. The audit
 * itself can take 5-30s depending on how many vision calls Check 1 (waffle
 * SKU rename) needs to make — we run it inline so the caller can show the
 * result in the toast.
 */
export async function POST(
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

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runPostScrapeAudit(id, null);
    return NextResponse.json({ audit: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audit failed";
    console.error(`[api/products/${id}/audit] error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
