import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  recalculatePricing,
  applyPricingToVariants,
} from "@/services/pricing.service";
import { DEFAULT_SCRAPE_OPTIONS, ScrapeOptionsSchema } from "@/types/scrape-options";

const VALID_TIERS = ["launch", "stretch", "bundle"] as const;
type ApplyTier = (typeof VALID_TIERS)[number];
function isApplyTier(v: unknown): v is ApplyTier {
  return typeof v === "string" && (VALID_TIERS as readonly string[]).includes(v);
}

export async function POST(
  req: NextRequest,
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

  let bodyRaw: unknown = {};
  try {
    bodyRaw = await req.json();
  } catch {
    bodyRaw = {};
  }
  const body = bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};

  // tierOverride is NOT a ScrapeOptions field — pull it off the body before
  // passing the rest to ScrapeOptionsSchema.parse.
  const { tierOverride, ...overrides } = body;
  const applyTier: ApplyTier | null = isApplyTier(tierOverride) ? tierOverride : null;

  let resolvedOptions;
  try {
    resolvedOptions = ScrapeOptionsSchema.parse({ ...DEFAULT_SCRAPE_OPTIONS, ...overrides });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid options";
    return NextResponse.json({ error: `Invalid options: ${message}` }, { status: 400 });
  }

  try {
    // Recalculate the rationale (with web search) only when no tierOverride
    // was sent — when the user clicks an existing ladder tier they don't want
    // a fresh AI run, just apply the existing tier to variants.
    let rationale = null as Awaited<ReturnType<typeof recalculatePricing>> | null;
    if (!applyTier) {
      rationale = await recalculatePricing(id, resolvedOptions);
    } else {
      // Read existing pricingNotes from DB so the response can return it.
      const product = await prisma.product.findUnique({
        where: { id },
        select: { pricingNotes: true },
      });
      if (product?.pricingNotes) {
        try {
          rationale = JSON.parse(product.pricingNotes);
        } catch {
          rationale = null;
        }
      }
      // No-op if rationale is still null — applyPricingToVariants reads from DB itself.
      await applyPricingToVariants(id, applyTier, resolvedOptions);
    }

    // Field name matches what the client (pricing-notes-card.tsx) reads.
    return NextResponse.json({
      pricingNotes: rationale,
      applied: applyTier,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pricing error";
    console.error(`[api/products/${id}/recalculate-pricing] error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
