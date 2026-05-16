import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { rewriteProductDescription } from "@/services/description-enrichment.service";

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await rewriteProductDescription(id);
    if (!result.hadCachedContext) {
      return NextResponse.json(
        {
          error:
            "No enrichment data cached for this product — can't rewrite. Re-trigger the source URL to scrape fresh data first.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      descriptionHtml: result.descriptionHtml,
      liveVariantCount: result.liveVariantCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rewrite failed";
    console.error(`[api/products/${id}/rewrite-description] error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
