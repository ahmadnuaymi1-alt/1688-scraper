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
  const user = await getCurrentUser();

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
      scrapeJob: { select: { options: true, sourceUrl: true } },
    },
  });

  if (!product) {
    notFound();
  }

  // Prev/next within the same user's products, ordered newest-first by
  // createdAt. "Up arrow" = newer (more recent than this one), "Down arrow" =
  // older. Returns null when this is the first/last scrape.
  const navScope = { userId: product.userId };
  const [newerProduct, olderProduct] = await Promise.all([
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
  ]);

  // Only fetch connections for the current user; in localhost-dev no user
  // may be present, so just return [].
  const connections: ProductEditorConnection[] = user
    ? (
        await prisma.shopifyConnection.findMany({
          where: { userId: user.id },
          select: { id: true, label: true },
          orderBy: { createdAt: "asc" },
        })
      ).map((c) => ({ id: c.id, label: c.label }))
    : [];

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
    optionNames: parseOptionNames(product.optionNames),
    pricingNotes: parsePricingNotes(product.pricingNotes),
    sourceUrl: product.scrapeJob?.sourceUrl ?? null,
    variants,
    images,
    connections,
    newerProductId: newerProduct?.id ?? null,
    olderProductId: olderProduct?.id ?? null,
  };

  return <ProductEditor product={data} />;
}
