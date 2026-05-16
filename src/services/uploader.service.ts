import { prisma } from "@/lib/db";
import {
  DEFAULT_SCRAPE_OPTIONS,
  type ScrapeOptions,
  type DefaultInventory,
} from "@/types/scrape-options";
import { gramsToLbs, convertPkgDimsStringToInches } from "@/lib/units";
import type { UploadRecord, Product, Variant, ProductImage } from "@prisma/client";

/** Shopify Admin GraphQL API version */
const SHOPIFY_API_VERSION = "2024-10";

// ---------------------------------------------------------------------------
// GraphQL operations
// ---------------------------------------------------------------------------

const PRODUCT_SET_MUTATION = `
  mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        handle
        onlineStoreUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const PUBLICATIONS_QUERY = `
  query publications {
    publications(first: 20) {
      edges { node { id name } }
    }
  }
`;

const PUBLISHABLE_PUBLISH_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const PRODUCT_VARIANTS_INVENTORY_QUERY = `
  query productVariantsInventory($id: ID!) {
    product(id: $id) {
      variants(first: 100) {
        edges {
          node {
            id
            inventoryItem {
              id
              inventoryLevels(first: 1) {
                edges {
                  node {
                    location { id name }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        changes { name delta }
      }
      userErrors { field message code }
    }
  }
`;

const LOCATIONS_QUERY = `
  query locations {
    locations(first: 5) {
      edges { node { id name } }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

interface GraphQLUserError {
  field?: string[] | null;
  message: string;
  code?: string;
}

interface ProductSetData {
  productSet?: {
    product?: { id: string; handle: string; onlineStoreUrl?: string | null } | null;
    userErrors?: GraphQLUserError[];
  };
}

interface PublicationsData {
  publications?: {
    edges: Array<{ node: { id: string; name: string } }>;
  };
}

interface PublishablePublishData {
  publishablePublish?: {
    userErrors?: GraphQLUserError[];
  };
}

interface LocationsData {
  locations?: {
    edges: Array<{ node: { id: string; name: string } }>;
  };
}

interface InventoryVariantsData {
  product?: {
    variants: {
      edges: Array<{
        node: {
          id: string;
          inventoryItem: {
            id: string;
            inventoryLevels: {
              edges: Array<{
                node: { location: { id: string; name: string } };
              }>;
            };
          };
        };
      }>;
    };
  } | null;
}

interface InventorySetData {
  inventorySetQuantities?: {
    inventoryAdjustmentGroup?: {
      createdAt: string;
      reason: string;
      changes: Array<{ name: string; delta: number }>;
    } | null;
    userErrors?: GraphQLUserError[];
  };
}

type GenericObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a store domain (strip protocol / trailing slash). */
function normalizeStoreDomain(storeDomain: string): string {
  if (storeDomain.includes("://")) {
    try {
      return new URL(storeDomain).hostname;
    } catch {
      return storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  }
  return storeDomain.replace(/\/$/, "");
}

/** Make a single Shopify Admin GraphQL request. */
async function shopifyRequest<T>(
  storeDomain: string,
  accessToken: string,
  query: string,
  variables?: GenericObject,
): Promise<GraphQLResponse<T>> {
  const domain = normalizeStoreDomain(storeDomain);
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Shopify HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }

  return (await response.json()) as GraphQLResponse<T>;
}

/** Pick a quantity from an inventory option. */
function pickInventoryQuantity(inv: DefaultInventory): number {
  if (inv.type === "fixed") return inv.value;
  const min = Math.min(inv.min, inv.max);
  const max = Math.max(inv.min, inv.max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Generate a deterministic SKU when generateSku is enabled and variant has none. */
function autoGenerateSku(product: Product, variant: Variant, index: number): string {
  const base = (product.handle || product.id || "PROD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const suffix = String(index + 1).padStart(3, "0");
  return `${base}-${suffix}`;
}

/** Parse the JSON-encoded optionNames array from Product.optionNames. */
function parseOptionNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v) => typeof v === "string");
    }
  } catch {
    // ignore
  }
  return [];
}

/** Format graphql user errors into a single string. */
function formatUserErrors(errors: GraphQLUserError[] | undefined): string {
  if (!errors || errors.length === 0) return "";
  return errors
    .map(
      (e) =>
        `${e.message}${e.code ? ` [${e.code}]` : ""}${
          e.field && e.field.length ? ` (field: ${e.field.join(".")})` : ""
        }`,
    )
    .join("; ");
}

/** Format top-level GraphQL errors. */
function formatGraphQLErrors(errors: GraphQLResponse<unknown>["errors"]): string {
  if (!errors || errors.length === 0) return "";
  return errors.map((e) => e.message).join("; ");
}

// ---------------------------------------------------------------------------
// Build product input
// ---------------------------------------------------------------------------

interface BuildInputArgs {
  product: Product;
  variants: Variant[];
  images: ProductImage[];
  options: ScrapeOptions;
}

interface BuiltInput {
  input: GenericObject;
  optionNames: string[];
}

function buildProductSetInput({ product, variants, images, options }: BuildInputArgs): BuiltInput {
  // Build a quick lookup from image id → image so we can resolve each
  // variant's featuredImageId to a sourceUrl that matches one of the files
  // we're about to send to Shopify.
  const imageById = new Map(images.map((img) => [img.id, img]));
  // Build option names + value sets from variants
  const sourceOptionNames = parseOptionNames(product.optionNames);

  const hasOption1 = variants.some((v) => v.option1 && v.option1 !== "Default Title");
  const hasOption2 = variants.some((v) => v.option2);
  const hasOption3 = variants.some((v) => v.option3);

  const optionNames: string[] = [];
  const optionValues: Map<string, Set<string>> = new Map();

  const isSingleVariantNoOptions =
    variants.length === 1 &&
    (!variants[0].option1 || variants[0].option1 === "Default Title") &&
    !variants[0].option2 &&
    !variants[0].option3;

  if (isSingleVariantNoOptions) {
    optionNames.push("Title");
    optionValues.set("Title", new Set(["Default Title"]));
  } else if (variants.length > 0) {
    if (hasOption1) {
      const values = Array.from(
        new Set(
          variants
            .map((v) => v.option1 || "Default")
            .filter((v) => v !== "Default Title"),
        ),
      );
      const name = sourceOptionNames[0] || "Option1";
      optionNames.push(name);
      optionValues.set(name, new Set(values));
    }
    if (hasOption2) {
      const values = Array.from(new Set(variants.map((v) => v.option2 || "Default")));
      let name = sourceOptionNames[1] || "Option2";
      if (optionNames.includes(name)) name = sourceOptionNames[1] || "Option2";
      optionNames.push(name);
      optionValues.set(name, new Set(values));
    }
    if (hasOption3) {
      const values = Array.from(new Set(variants.map((v) => v.option3 || "Default")));
      let name = sourceOptionNames[2] || "Option3";
      if (optionNames.includes(name)) name = sourceOptionNames[2] || "Option3";
      optionNames.push(name);
      optionValues.set(name, new Set(values));
    }
  }

  // Tags: split + comma-join (deduplicated)
  const tagList = product.tags
    ? Array.from(
        new Set(
          product.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      )
    : [];

  // Compose status
  const status = (options.productStatus || "draft").toUpperCase(); // "DRAFT" | "ACTIVE"

  const input: GenericObject = {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml || "",
    vendor: product.vendor || "",
    productType: product.productType || "",
    tags: tagList,
    status,
  };

  if (options.templateSuffix) {
    input.templateSuffix = options.templateSuffix;
  }

  // SEO meta description
  if (product.metaDescription) {
    input.seo = { description: product.metaDescription };
  }

  // Product options
  if (optionNames.length > 0) {
    input.productOptions = optionNames.map((name, index) => ({
      name,
      position: index + 1,
      values: Array.from(optionValues.get(name) || []).map((v) => ({ name: v })),
    }));
  }

  // Variants
  if (variants.length > 0) {
    input.variants = variants.map((v, index) => {
      const variantObj: GenericObject = {
        price: v.price,
      };

      if (optionNames.length > 0) {
        const valueArr = [v.option1, v.option2, v.option3];
        variantObj.optionValues = optionNames.map((name, i) => ({
          optionName: name,
          name: valueArr[i] || "Default",
        }));
      }

      if (!options.omitCompareAtPrice && v.compareAtPrice) {
        variantObj.compareAtPrice = v.compareAtPrice;
      }

      // SKU: keep explicit, otherwise auto-generate when allowed
      const sku =
        v.sku && v.sku.trim().length > 0
          ? v.sku
          : options.generateSku
            ? autoGenerateSku(product, v, index)
            : null;
      if (sku) variantObj.sku = sku;
      if (v.barcode) variantObj.barcode = v.barcode;

      const policy = options.inventoryPolicy || "deny";
      variantObj.inventoryPolicy = policy === "continue" ? "CONTINUE" : "DENY";

      // Inventory item: tracked + weight in pounds (1688 stores grams)
      const inventoryItem: GenericObject = { tracked: true };
      if (v.weight !== null && v.weight !== undefined) {
        inventoryItem.measurement = {
          weight: {
            value: Number(gramsToLbs(v.weight).toFixed(2)),
            unit: "POUNDS",
          },
        };
      }
      variantObj.inventoryItem = inventoryItem;

      // Per-variant metafield: packaging_dims (converted cm → inches)
      const metafields: GenericObject[] = [];
      if (v.packagingDimensions && v.packagingDimensions.trim().length > 0) {
        metafields.push({
          namespace: "custom",
          key: "packaging_dims",
          value: convertPkgDimsStringToInches(v.packagingDimensions),
          type: "single_line_text_field",
        });
      }
      if (metafields.length > 0) {
        variantObj.metafields = metafields;
      }

      // Bind featured image: ProductSetInput.variants[].file references one
      // of the files in input.files[] by originalSource. We resolve the
      // variant's featuredImageId → the image's sourceUrl → match the file.
      if (v.featuredImageId) {
        const featured = imageById.get(v.featuredImageId);
        if (featured && featured.downloadStatus === "downloaded") {
          variantObj.file = {
            originalSource: featured.sourceUrl,
            contentType: "IMAGE",
          };
        }
      }

      return variantObj;
    });
  }

  // Product-level metafields
  const productMetafields: GenericObject[] = [];
  if (product.metaDescription && product.metaDescription.trim().length > 0) {
    productMetafields.push({
      namespace: "custom",
      key: "meta_description",
      value: product.metaDescription,
      type: "single_line_text_field",
    });
  }
  if (productMetafields.length > 0) {
    input.metafields = productMetafields;
  }

  // Files (images): pass downloaded images. Skip non-downloaded.
  const usableImages = images.filter((img) => img.downloadStatus === "downloaded");
  if (usableImages.length > 0) {
    input.files = usableImages
      .sort((a, b) => a.position - b.position)
      .map((img) => ({
        originalSource: img.sourceUrl,
        alt: img.altText || "",
        contentType: "IMAGE",
      }));
  }

  return { input, optionNames };
}

// ---------------------------------------------------------------------------
// Publish to channels
// ---------------------------------------------------------------------------

async function publishToAllChannels(
  storeDomain: string,
  accessToken: string,
  productGid: string,
): Promise<void> {
  const pubResp = await shopifyRequest<PublicationsData>(
    storeDomain,
    accessToken,
    PUBLICATIONS_QUERY,
  );
  if (pubResp.errors && pubResp.errors.length > 0) {
    throw new Error(`publications query failed: ${formatGraphQLErrors(pubResp.errors)}`);
  }
  const publications = pubResp.data?.publications?.edges?.map((e) => e.node) || [];
  if (publications.length === 0) return;

  const publishInput = publications.map((p) => ({ publicationId: p.id }));

  const publishResp = await shopifyRequest<PublishablePublishData>(
    storeDomain,
    accessToken,
    PUBLISHABLE_PUBLISH_MUTATION,
    { id: productGid, input: publishInput },
  );

  if (publishResp.errors && publishResp.errors.length > 0) {
    throw new Error(`publishablePublish failed: ${formatGraphQLErrors(publishResp.errors)}`);
  }
  const userErrors = publishResp.data?.publishablePublish?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(`publishablePublish userErrors: ${formatUserErrors(userErrors)}`);
  }
}

// ---------------------------------------------------------------------------
// Set inventory
// ---------------------------------------------------------------------------

async function setInventoryQuantities(
  storeDomain: string,
  accessToken: string,
  productGid: string,
  defaultInventory: DefaultInventory,
): Promise<void> {
  // Retry up to 3 times in case Shopify hasn't propagated inventory items yet
  let variantsData: InventoryVariantsData | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await shopifyRequest<InventoryVariantsData>(
      storeDomain,
      accessToken,
      PRODUCT_VARIANTS_INVENTORY_QUERY,
      { id: productGid },
    );
    if (resp.errors && resp.errors.length > 0) {
      throw new Error(`inventory query failed: ${formatGraphQLErrors(resp.errors)}`);
    }
    variantsData = resp.data;
    const found = variantsData?.product?.variants?.edges?.length || 0;
    if (found > 0) break;
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const variantNodes =
    variantsData?.product?.variants?.edges?.map((e) => e.node) || [];
  if (variantNodes.length === 0) {
    throw new Error("No variant inventory items found after retries");
  }

  // Determine location: use one from existing variant inventory levels, fall back to locations query
  let locationId: string | undefined =
    variantNodes[0]?.inventoryItem?.inventoryLevels?.edges?.[0]?.node?.location?.id;

  if (!locationId) {
    const locResp = await shopifyRequest<LocationsData>(
      storeDomain,
      accessToken,
      LOCATIONS_QUERY,
    );
    if (locResp.errors && locResp.errors.length > 0) {
      throw new Error(`locations query failed: ${formatGraphQLErrors(locResp.errors)}`);
    }
    locationId = locResp.data?.locations?.edges?.[0]?.node?.id;
  }

  if (!locationId) {
    throw new Error("No Shopify location available — cannot set inventory");
  }

  const quantities = variantNodes.map((node) => ({
    inventoryItemId: node.inventoryItem.id,
    locationId,
    quantity: pickInventoryQuantity(defaultInventory),
  }));

  const invResp = await shopifyRequest<InventorySetData>(
    storeDomain,
    accessToken,
    INVENTORY_SET_QUANTITIES_MUTATION,
    {
      input: {
        reason: "correction",
        name: "on_hand",
        ignoreCompareQuantity: true,
        quantities,
      },
    },
  );

  if (invResp.errors && invResp.errors.length > 0) {
    throw new Error(`inventorySetQuantities failed: ${formatGraphQLErrors(invResp.errors)}`);
  }
  const userErrors = invResp.data?.inventorySetQuantities?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(`inventorySetQuantities userErrors: ${formatUserErrors(userErrors)}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload a Product (with its variants + images) to a Shopify store.
 *
 * Creates an UploadRecord row in `pending` state at the start. On success the
 * record is updated with status `success` and the resulting Shopify product GID.
 * On any failure the errorMessage is persisted and the error is rethrown.
 */
export async function uploadProductToShopify(
  productId: string,
  connectionId: string,
  options?: Partial<ScrapeOptions>,
): Promise<UploadRecord> {
  // Merge options with defaults so we always work with a fully-resolved object
  const resolvedOptions: ScrapeOptions = {
    ...DEFAULT_SCRAPE_OPTIONS,
    ...(options || {}),
  };

  // Pre-flight: confirm product + connection exist
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) {
    throw new Error(`ShopifyConnection ${connectionId} not found`);
  }

  // Create the upload record at start, status = pending
  const uploadRecord = await prisma.uploadRecord.create({
    data: {
      productId: product.id,
      connectionId: connection.id,
      status: "pending",
    },
  });

  try {
    const { input } = buildProductSetInput({
      product,
      variants: product.variants,
      images: product.images,
      options: resolvedOptions,
    });

    const createResp = await shopifyRequest<ProductSetData>(
      connection.storeDomain,
      connection.accessToken,
      PRODUCT_SET_MUTATION,
      { input, synchronous: true },
    );

    if (createResp.errors && createResp.errors.length > 0) {
      throw new Error(`productSet GraphQL errors: ${formatGraphQLErrors(createResp.errors)}`);
    }

    const userErrors = createResp.data?.productSet?.userErrors;
    if (userErrors && userErrors.length > 0) {
      throw new Error(`productSet userErrors: ${formatUserErrors(userErrors)}`);
    }

    const shopifyProduct = createResp.data?.productSet?.product;
    if (!shopifyProduct?.id) {
      throw new Error("productSet mutation did not return a product ID");
    }

    // Optional: publish to all channels
    if (resolvedOptions.publishToAllChannels) {
      try {
        await publishToAllChannels(
          connection.storeDomain,
          connection.accessToken,
          shopifyProduct.id,
        );
      } catch (err) {
        // Publishing failures shouldn't fail the upload — surface as part of errorMessage instead?
        // The legacy uploader logged-and-continued; we do the same here but record a soft warning.
        const warn = err instanceof Error ? err.message : String(err);
        console.warn(`[uploader] publish step failed: ${warn}`);
      }
    }

    // Inventory
    try {
      await setInventoryQuantities(
        connection.storeDomain,
        connection.accessToken,
        shopifyProduct.id,
        resolvedOptions.defaultInventory,
      );
    } catch (err) {
      const warn = err instanceof Error ? err.message : String(err);
      console.warn(`[uploader] inventory step failed: ${warn}`);
    }

    const updated = await prisma.uploadRecord.update({
      where: { id: uploadRecord.id },
      data: {
        status: "success",
        shopifyProductId: shopifyProduct.id,
        shopifyHandle: shopifyProduct.handle,
        completedAt: new Date(),
      },
    });

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await prisma.uploadRecord.update({
        where: { id: uploadRecord.id },
        data: {
          status: "failed",
          errorMessage: message.slice(0, 4000),
          completedAt: new Date(),
        },
      });
    } catch {
      // ignore secondary write failure — original error is more important
    }
    throw error;
  }
}

/**
 * Convenience wrapper: push a product as a DRAFT.
 */
export async function pushToShopifyDraft(
  productId: string,
  connectionId: string,
): Promise<UploadRecord> {
  return uploadProductToShopify(productId, connectionId, { productStatus: "draft" });
}
