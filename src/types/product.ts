export interface ScrapedImage {
  sourceUrl: string;
  position: number;
  altText?: string;
  variantSourceId?: string;
  width?: number;
  height?: number;
}

export interface ScrapedVariant {
  title: string;
  option1?: string;
  option2?: string;
  option3?: string;
  price: string;
  compareAtPrice?: string;
  supplierCost?: string;
  sku?: string;
  barcode?: string;
  weight?: number;
  weightUnit?: "g" | "kg" | "lb" | "oz";
  packagingDimensions?: string;
  position: number;
  sourceVariantId?: string;
  supplierLabel1?: string;
  supplierLabel2?: string;
  supplierLabel3?: string;
  imageUrl?: string;
}

export interface ScrapedProduct {
  sourceUrl: string;
  sourcePlatform: "1688";
  title: string;
  handle: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  descriptionHtml?: string;
  metaDescription?: string;
  optionNames: string[];
  minOrderQuantity?: number;
  productWeightG?: number;
  productPackagingDimensions?: string;
  variants: ScrapedVariant[];
  images: ScrapedImage[];
  rawPayload: unknown;
}

export interface ProductContext {
  extractedSpecs: Array<{ name: string; value: string }>;
  featureCallouts: string[];
  marketingAngles: string[];
  supplierAttributes?: Array<{ name: string; value: string }>;
  supplierWeightG?: number;
}
