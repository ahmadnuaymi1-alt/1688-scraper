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
        scrapeJob: { select: { options: true, sourceUrl: true } },
      },
    }),
  ]);

  if (!product) {
    notFound();
  }

  // Prev/next within the same user's products, plus connections — all three
  // queries can now run in parallel since they only depend on the product's
  // userId / createdAt which we already have.
  const navScope = { userId: product.userId };
  const [newerProduct, olderProduct, connectionRows] = await Promise.all([
    prisma.product.findFirst({
      where: { ...navScope, createdAt: { gt: product.createdAt } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    prisma.product.findFirst({
      where: { ...navScope, createdAt: { lt: product.createdAt } },
      orderBy: { createdAt: "desc" },
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
