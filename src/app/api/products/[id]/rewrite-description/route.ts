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
  // Load productContext upfront so the "no cached enrichment" case still returns
  // 409 synchronously — we only detach the actual LLM call, not the precondition
  // check. Avoids the silent-fail UX where the user clicks Rewrite and never
  // finds out the product wasn't ready.
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, userId: true, productContext: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!product.productContext) {
    return NextResponse.json(
      {
        error:
          "No enrichment data cached for this product — can't rewrite. Re-trigger the source URL to scrape fresh data first.",
      },
      { status: 409 },
    );
  }

  // Fire-and-forget: return 202 immediately, run the LLM call as a detached
  // promise so the user can navigate away and the work still completes.
  // The .catch surfaces unhandled rejections to the server log instead of
  // crashing the Node process.
  void rewriteProductDescription(id).catch((err) => {
    console.error(`[api/products/${id}/rewrite-description] background error:`, err);
  });
  return NextResponse.json({ status: "queued" }, { status: 202 });
}
