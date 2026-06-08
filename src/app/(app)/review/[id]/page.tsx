import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  ProductEditor,
  type ProductEditorData,
  type ProductEditorConnection,
} from "@/components/review/product-editor";
import type {
  VariantTableItem,
} from "@/components/review/variant-table";
import type { GalleryImage } from "@/components/review/image-gallery";
import type { AiPricingRationale } from "@/types/pricing-rationale";
import { getCurrentUser } from "@/lib/auth";
import { UploadToShopifyButton } from "@/components/review/upload-to-shopify-button";
import { computeLandedFromRawPayload } from "@/lib/pricing/landed-cost";

function parseOptionNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
  } catch {
    // Fall through — may be a comma-separated list.
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePricingNotes(raw: string | null): AiPricingRationale | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AiPricingRationale;
    if (parsed && parsed.ladder && parsed.recommended) return parsed;
  } catch {
    // ignore
  }
  return null;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReviewProductPage({ params }: PageProps) {
  const { id } = await params;

  // Fetch user + product in parallel — both are required before we can
  // build the rest of the page, and they have no dependency on each other.
  const [user, product] = await Promise.all([
    getCurrentUser(),
    prisma.product.findUnique({
      where: { id },
      include: {
        variants: { orderBy: { position: "asc" } },
        images: { orderBy: { position: "asc" } },
        scrapeJob: { select: { options: true, sourceUrl: true, createdAt: true } },
      },
    }),
  ]);

  if (!product) {
    notFound();
  }

  // Prev/next within the same user's products, plus connections — all three
  // queries can now run in parallel since they only depend on the product's
  // userId / scrapeJob.createdAt which we already have.
  //
  // Adjacency is keyed off ScrapeJob.createdAt (when the URL was enqueued), NOT
  // Product.createdAt (when Phase 1 finished writing the product). The imports
  // list orders by ScrapeJob.createdAt, and a product's own createdAt drifts out
  // of that order because scrape duration / retries / rescrapes vary — so keying
  // nav off Product.createdAt would land on a non-adjacent product.
  const navScope = { userId: product.userId };
  const navAnchor = product.scrapeJob?.createdAt ?? product.createdAt;
  const [newerProduct, olderProduct, connectionRows] = await Promise.all([
    prisma.product.findFirst({
      where: { ...navScope, scrapeJob: { createdAt: { gt: navAnchor } } },
      orderBy: { scrapeJob: { createdAt: "asc" } },
      select: { id: true },
    }),
    prisma.product.findFirst({
      where: { ...navScope, scrapeJob: { createdAt: { lt: navAnchor } } },
      orderBy: { scrapeJob: { createdAt: "desc" } },
      select: { id: true },
    }),
    user
      ? prisma.shopifyConnection.findMany({
          where: { userId: user.id },
          select: { id: true, label: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([] as Array<{ id: string; label: string }>),
  ]);

  // Only fetch connections for the current user; in localhost-dev no user
  // may be present, so just return [].
  const connections: ProductEditorConnection[] = connectionRows.map((c) => ({
    id: c.id,
    label: c.label,
  }));

  const variants: VariantTableItem[] = product.variants.map((v) => ({
    id: v.id,
    title: v.title,
    option1: v.option1,
    option2: v.option2,
    option3: v.option3,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    sku: v.sku,
    barcode: v.barcode,
    weight: v.weight,
    weightUnit: v.weightUnit,
    packagingDimensions: v.packagingDimensions,
    position: v.position,
    isHidden: v.isHidden,
    featuredImageId: v.featuredImageId,
  }));

  const images: GalleryImage[] = product.images.map((img) => ({
    id: img.id,
    sourceUrl: img.sourceUrl,
    variantId: img.variantId,
    altText: img.altText,
    position: img.position,
    storagePath: img.storagePath,
    fileName: img.fileName,
    imageType: img.imageType,
    // Prisma Client types may be stale until the dev server restarts and
    // picks up the new `keep` column — read defensively.
    keep: (img as { keep?: boolean }).keep ?? false,
  }));

  // Compute landed cost from rawPayload (bypasses the currency-corrupted
  // Variant.supplierCost). Same value applies to every variant since landed
  // is per-product (supplier wholesale + weight-bracket shipping). Null when
  // rawPayload is missing or unparseable — variant table renders "—".
  const landed = computeLandedFromRawPayload(product.rawPayload);

  const data: ProductEditorData = {
    id: product.id,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    descriptionHtml: product.descriptionHtml,
    metaDescription: product.metaDescription,
    lifestyleUnitMode: ((): "auto" | "single" | "multi" => {
      const v = product.lifestyleUnitMode;
      return v === "single" || v === "multi" || v === "auto" ? v : "auto";
    })(),
    optionNames: parseOptionNames(product.optionNames),
    pricingNotes: parsePricingNotes(product.pricingNotes),
    sourceUrl: product.scrapeJob?.sourceUrl ?? null,
    variants,
    images,
    connections,
    landedCostUSD: landed?.landedUSD ?? null,
    newerProductId: newerProduct?.id ?? null,
    olderProductId: olderProduct?.id ?? null,
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="truncate text-sm font-medium text-muted-foreground">
          {data.title}
        </h1>
        <UploadToShopifyButton productId={data.id} />
      </div>
      <ProductEditor product={data} />
    </>
  );
}
