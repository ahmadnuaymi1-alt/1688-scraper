/**
 * Scraper service — top-level orchestrator for the two-phase 1688 pipeline.
 *
 * Phase 1 (`handleScrapeJob`): Bright Data → page-state → description fetch →
 *   extract → variant translation → DB persistence → image download. Ends by
 *   transitioning the job to `applying_rules`.
 *
 * Phase 2 (`handleRulesJob`): Description enrichment (always on) → optional
 *   variant curation → optional suggested pricing → toggle-gated transformation
 *   rules (title / description / tags / image / seo) → mark ready → optional
 *   auto-upload to Shopify.
 *
 * Both handlers register with the job processor at module load. Failures
 * propagate so the processor can call failScrapeJob — except auto-upload
 * failure, which is logged but does NOT fail the parent job (the product is
 * already `ready` at that point).
 */

import { prisma } from "@/lib/db";
import { fetchViaBrightData } from "@/lib/scraper/bright-data-client";
import { parsePageState } from "@/lib/scraper/page-state-parser";
import { extractItemcdnUrl, fetch1688Description } from "@/lib/scraper/desc-fetcher";
import { extract1688 } from "@/lib/scraper/alibaba1688-extractor";
import { downloadImagesToSupabase } from "@/lib/scraper/image-downloader";
import { dedupeVariantSwatches } from "@/lib/scraper/dedupe-variant-swatches";
import {
  registerScrapeHandler,
  registerRulesHandler,
} from "@/lib/jobs/processor";
import {
  addJobLog,
  markApplyingRules,
  completeScrapeJob,
} from "@/lib/jobs/queue";
import {
  ScrapeOptionsSchema,
  type ScrapeOptions,
  DEFAULT_SCRAPE_OPTIONS,
} from "@/types/scrape-options";
import type { ScrapedProduct } from "@/types/product";
import { translateVariantsToEnglish } from "@/services/variant-translator.service";
import { enrichDescription1688 } from "@/services/description-enrichment.service";
import { autoCurateVariants } from "@/services/variant-curation.service";
import {
  recalculatePricing,
  applyPricingToVariants,
} from "@/services/pricing.service";
import { uploadProductToShopify } from "@/services/uploader.service";
import { applyRulesByCategory } from "@/services/rule.service";

const URL_RE = /^https?:\/\/(detail\.)?(1688|m\.1688)\.com\//;

/** Load + parse a job's options blob with zod; falls back to defaults. */
async function loadOptions(jobId: string): Promise<ScrapeOptions> {
  const job = await prisma.scrapeJob.findUnique({
    where: { id: jobId },
    select: { options: true },
  });
  if (!job?.options) return DEFAULT_SCRAPE_OPTIONS;
  try {
    const parsed = JSON.parse(job.options);
    return ScrapeOptionsSchema.parse(parsed);
  } catch (err) {
    console.warn(
      `[scraper.service] loadOptions: failed to parse job ${jobId} options, falling back to defaults`,
      err,
    );
    return DEFAULT_SCRAPE_OPTIONS;
  }
}

// ---------------------------------------------------------------------------
// Phase 1
// ---------------------------------------------------------------------------

export async function handleScrapeJob(jobId: string, sourceUrl: string): Promise<void> {
  await addJobLog(jobId, "info", `Phase 1: starting scrape for ${sourceUrl}`);

  // Idempotency guard: queue recovery can re-pick a row whose Phase 1 already
  // produced a Product. Bail before the unique-scrapeJobId Product.create throws.
  const existing = await prisma.product.findUnique({
    where: { scrapeJobId: jobId },
    select: { id: true },
  });
  if (existing) {
    await addJobLog(
      jobId,
      "info",
      `Phase 1: product ${existing.id} already exists for this job — skipping persistence and transitioning to Phase 2`,
    );
    await markApplyingRules(jobId);
    return;
  }

  // 1) Validate URL.
  if (!URL_RE.test(sourceUrl)) {
    throw new Error(
      `Source URL "${sourceUrl}" is not a recognized 1688 detail page (expected detail.1688.com or m.1688.com).`,
    );
  }

  // 2) Bright Data fetch.
  await addJobLog(jobId, "info", "Phase 1: fetching HTML via Bright Data Web Unlocker");
  const html = await fetchViaBrightData(sourceUrl);
  await addJobLog(jobId, "info", `Phase 1: HTML fetched (${html.length} bytes)`);

  // 3) Page-state parse — primarily to obtain descriptionUrl (descriptionHtml
  //    is fetched separately so we have it available before extract1688).
  const offerIdMatch = sourceUrl.match(/\/offer\/(\d+)\.html/);
  if (!offerIdMatch) {
    throw new Error(`Could not extract offerId from URL ${sourceUrl}`);
  }
  const pageState = parsePageState(html, offerIdMatch[1]);
  if (!pageState) {
    throw new Error("parsePageState returned null — couldn't locate title in HTML");
  }
  await addJobLog(
    jobId,
    "info",
    `Phase 1: page state parsed (offer ${pageState.offerId}, ${pageState.images.length} image(s), ${pageState.featureAttributes.length} attribute(s))`,
  );

  // 4) Description fetch (best-effort).
  let descriptionHtml: string | undefined;
  if (pageState.descriptionUrl) {
    const itemcdnUrl = extractItemcdnUrl(pageState.descriptionUrl);
    await addJobLog(jobId, "info", `Phase 1: fetching description from ${itemcdnUrl}`);
    const desc = await fetch1688Description(pageState.descriptionUrl);
    if (desc) {
      descriptionHtml = desc.html;
      await addJobLog(
        jobId,
        "info",
        `Phase 1: description fetched (${desc.html.length} bytes, ${desc.imageUrls.length} embedded image(s))`,
      );
    } else {
      await addJobLog(
        jobId,
        "warn",
        "Phase 1: description fetch returned null — continuing without descriptionHtml",
      );
    }
  } else {
    await addJobLog(
      jobId,
      "info",
      "Phase 1: page state has no descriptionUrl — continuing without descriptionHtml",
    );
  }

  // 5) Extract to canonical ScrapedProduct.
  const extractInput: { html: string; sourceUrl: string; descriptionHtml?: string } = {
    html,
    sourceUrl,
  };
  if (descriptionHtml !== undefined) extractInput.descriptionHtml = descriptionHtml;
  const scraped: ScrapedProduct = await extract1688(extractInput);
  await addJobLog(
    jobId,
    "info",
    `Phase 1: extracted "${scraped.title}" — ${scraped.variants.length} variant(s), ${scraped.images.length} image(s)`,
  );

  // 6) Translate variant axes to English (in-place mutation).
  await translateVariantsToEnglish(scraped);
  await addJobLog(
    jobId,
    "info",
    `Phase 1: variants translated — option names: ${scraped.optionNames.join(" / ") || "(none)"}`,
  );

  // 7) Resolve options from the job row.
  const options = await loadOptions(jobId);

  // 7b) Build a per-variant packing-dimensions lookup from the Packing
  // section's multi-row table (when present). Each row's `type` cell is the
  // Chinese variant label (e.g. "白光"), so we match by substring against the
  // variant's original supplierLabel*. Falls back to specs / product-level.
  const packingRows = pageState.packingDimensionsRows;
  function matchPackingRow(v: typeof scraped.variants[number]) {
    if (packingRows.length === 0) return null;
    if (packingRows.length === 1) return packingRows[0];
    const labels = [v.supplierLabel1, v.supplierLabel2, v.supplierLabel3]
      .filter((s): s is string => !!s);
    for (const row of packingRows) {
      if (!row.type) continue;
      for (const label of labels) {
        if (label.includes(row.type) || row.type.includes(label)) return row;
      }
    }
    return null;
  }
  function formatPackingDims(row: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }): string | null {
    const parts = [row.lengthCm, row.widthCm, row.heightCm].filter(
      (n): n is number => n !== null,
    );
    if (parts.length < 2) return null;
    return parts.map((n) => String(n)).join(" × ") + " cm";
  }

  // 8) Persist Product + Variants. We use a single transaction so a partial
  //    failure can't leave the product without variants.
  const job = await prisma.scrapeJob.findUnique({
    where: { id: jobId },
    select: { userId: true },
  });

  // Supplier-snapshot blob preserved on Product.productContext until Phase 2
  // overwrites with the full ProductContext (extractedSpecs/featureCallouts/etc).
  const phase1Context = {
    supplierAttributes: pageState.featureAttributes,
    supplierWeightG: pageState.productWeightG,
    _stage: "phase1" as const,
  };

  // Apply vendor / productType / extraTags overrides from options before save.
  const vendor = options.vendor ?? scraped.vendor;
  const productType = options.productType ?? scraped.productType;
  const tagSet = new Set<string>();
  for (const t of scraped.tags ?? []) tagSet.add(t);
  if (options.extraTags) {
    for (const t of options.extraTags.split(",").map((s) => s.trim()).filter(Boolean)) {
      tagSet.add(t);
    }
  }
  const tagsCsv = tagSet.size > 0 ? Array.from(tagSet).join(", ") : null;

  const productLevelWeight = scraped.productWeightG;

  const created = await prisma.product.create({
    data: {
      scrapeJobId: jobId,
      userId: job?.userId ?? null,
      title: scraped.title,
      handle: scraped.handle,
      vendor: vendor ?? null,
      productType: productType ?? null,
      tags: tagsCsv,
      descriptionHtml: scraped.descriptionHtml ?? null,
      metaDescription: scraped.metaDescription ?? null,
      optionNames:
        scraped.optionNames.length > 0 ? JSON.stringify(scraped.optionNames) : null,
      productContext: JSON.stringify(phase1Context),
      minOrderQuantity: scraped.minOrderQuantity ?? null,
      rawPayload: JSON.stringify(scraped.rawPayload ?? null),
      variants: {
        create: scraped.variants.map((v) => {
          // Resolve per-variant packing dimensions. User-confirmed priority:
          // Specs > Description > Packing-section (packing is shipping-box
          // dims, less accurate than product dims). Description-OCR doesn't
          // populate this field directly (it lands in extractedSpecs via
          // Phase 2 enrichment), so the per-variant fallback is:
          //   1. Already set on the scraped variant → use as-is
          //   2. Specs-section product-level dimension (most accurate)
          //   3. Packing-section table row matched to this variant
          //   4. null
          const packingRow = matchPackingRow(v);
          const packingDimsFromRow = packingRow ? formatPackingDims(packingRow) : null;
          const packagingDimensions =
            v.packagingDimensions ??
            scraped.productPackagingDimensions ??
            packingDimsFromRow ??
            null;
          // Same idea for weight — if the packing row has a per-type weight,
          // prefer it over the product-level weight.
          const weight =
            v.weight ??
            (packingRow?.weightG ?? null) ??
            productLevelWeight ??
            null;
          return {
            title: v.title,
            option1: v.option1 ?? null,
            option2: v.option2 ?? null,
            option3: v.option3 ?? null,
            price: v.price,
            compareAtPrice: v.compareAtPrice ?? null,
            supplierCost: v.supplierCost ?? null,
            sku: v.sku ?? null,
            barcode: v.barcode ?? null,
            weight,
            weightUnit:
              v.weightUnit ?? (weight !== null ? "g" : null),
            packagingDimensions,
            position: v.position,
            sourceVariantId: v.sourceVariantId ?? null,
            supplierLabel1: v.supplierLabel1 ?? null,
            supplierLabel2: v.supplierLabel2 ?? null,
            supplierLabel3: v.supplierLabel3 ?? null,
          };
        }),
      },
    },
    include: { variants: true },
  });

  await addJobLog(
    jobId,
    "info",
    `Phase 1: persisted Product ${created.id} with ${created.variants.length} variant(s)`,
  );

  // 9) Download gallery images to Supabase (and persist ProductImage rows).
  if (scraped.images.length > 0) {
    const variantIdBySourceId = new Map<string, string>();
    for (const v of created.variants) {
      if (v.sourceVariantId) variantIdBySourceId.set(v.sourceVariantId, v.id);
    }
    await addJobLog(
      jobId,
      "info",
      `Phase 1: mapped ${variantIdBySourceId.size} variant source IDs for swatch linking`,
    );
    await addJobLog(
      jobId,
      "info",
      `Phase 1: downloading ${scraped.images.length} image(s) to Supabase Storage`,
    );
    try {
      const persisted = await downloadImagesToSupabase(scraped.images, created.id, variantIdBySourceId);
      const ok = persisted.filter((p) => p.downloadStatus === "downloaded").length;
      const failed = persisted.length - ok;
      await addJobLog(
        jobId,
        "info",
        `Phase 1: image download done — ${ok} ok, ${failed} failed`,
      );
    } catch (err) {
      // Image failure shouldn't block Phase 2 — log and move on.
      await addJobLog(
        jobId,
        "warn",
        `Phase 1: image download threw: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Fill-down: copy each linked swatch to sister variants sharing the same
    // option1 value. 1688 puts color on option1 in 95%+ of cases, so this
    // surfaces the color thumbnail on every charging-type/size sibling.
    try {
      const filled = await fillSwatchesByOption1(created.id);
      if (filled > 0) {
        await addJobLog(
          jobId,
          "info",
          `Phase 1: filled ${filled} sister-variant swatch(es) by option1`,
        );
      }
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 1: swatch fill-down threw: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Set default featured image per variant (hero if present, else swatch).
    // Hero gen hasn't run yet at scrape time, so this picks the swatch.
    try {
      const set = await setDefaultFeaturedImages(created.id);
      if (set > 0) {
        await addJobLog(
          jobId,
          "info",
          `Phase 1: set featuredImageId on ${set} variant(s)`,
        );
      }
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 1: featured-image default-set threw: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Dedup variant swatch images. Some 1688 sellers upload the same image
    // twice and the CDN hands back two different content-hash URLs, so two
    // variants end up with separate ProductImage rows that are visually
    // identical. Collapse those into one row and repoint sister variants
    // via featuredImageId, so hero-image generation doesn't double-process
    // the same source.
    try {
      const { duplicatesCollapsed, variantsRepointed, groupsExamined } =
        await dedupeVariantSwatches(created.id);
      if (duplicatesCollapsed > 0) {
        await addJobLog(
          jobId,
          "info",
          `Phase 1: deduped variant swatches — collapsed ${duplicatesCollapsed} duplicate row(s) across ${groupsExamined} group(s), repointed ${variantsRepointed} variant(s)`,
        );
      }
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 1: swatch dedup threw: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    await addJobLog(jobId, "info", "Phase 1: no images to download");
  }

  // 10) Transition to Phase 2.
  await markApplyingRules(jobId);
  await addJobLog(jobId, "info", "Phase 1: complete — transitioned to applying_rules");
}

// ---------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------

export async function handleRulesJob(jobId: string): Promise<void> {
  await addJobLog(jobId, "info", "Phase 2: starting rules + enrichment pass");

  // 1) Load Product (+ variants + images) and the job options.
  const product = await prisma.product.findFirst({
    where: { scrapeJobId: jobId },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    throw new Error(`Phase 2: no Product found for scrape job ${jobId}`);
  }

  const options = await loadOptions(jobId);

  // Parse the Phase-1 snapshot we stashed on Product.productContext.
  type Phase1Context = {
    supplierAttributes?: Array<{ name: string; value: string }>;
    supplierWeightG?: number;
  };
  let phase1Context: Phase1Context = {};
  if (product.productContext) {
    try {
      phase1Context = JSON.parse(product.productContext) as Phase1Context;
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 2: failed to parse productContext snapshot: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Parse stored optionNames JSON array.
  let optionNames: string[] = [];
  if (product.optionNames) {
    try {
      const parsed = JSON.parse(product.optionNames);
      if (Array.isArray(parsed)) {
        optionNames = parsed.filter((s): s is string => typeof s === "string");
      }
    } catch {
      // ignore
    }
  }

  // 2) Description enrichment — ALWAYS ON per spec.
  await addJobLog(jobId, "info", "Phase 2: description enrichment (Claude OCR + structure)");
  try {
    const scrapedShape: ScrapedProduct = {
      sourceUrl: "",
      sourcePlatform: "1688",
      title: product.title,
      handle: product.handle,
      ...(product.vendor ? { vendor: product.vendor } : {}),
      ...(product.productType ? { productType: product.productType } : {}),
      ...(product.descriptionHtml ? { descriptionHtml: product.descriptionHtml } : {}),
      optionNames,
      variants: [],
      images: [],
      rawPayload: null,
    };

    // Swatch images = variant-linked downloaded ProductImage rows. Passed as
    // the tier-4 fallback corpus for dimension extraction; enrichDescription1688
    // only OCRs them when tiers 1-3 produced no Dimensions row.
    const swatchImageUrls = product.images
      .filter((i) => i.variantId !== null && i.downloadStatus === "downloaded")
      .map((i) => i.sourceUrl);

    const enrichOpts: {
      supplierAttributes?: Array<{ name: string; value: string }>;
      supplierWeightG?: number;
      swatchImageUrls?: string[];
      log: (level: "info" | "warn" | "error", message: string) => Promise<void>;
    } = {
      log: async (level, message) => {
        await addJobLog(jobId, level, message);
      },
    };
    if (phase1Context.supplierAttributes) {
      enrichOpts.supplierAttributes = phase1Context.supplierAttributes;
    }
    if (phase1Context.supplierWeightG !== undefined) {
      enrichOpts.supplierWeightG = phase1Context.supplierWeightG;
    }
    if (swatchImageUrls.length > 0) {
      enrichOpts.swatchImageUrls = swatchImageUrls;
    }

    const enriched = await enrichDescription1688(scrapedShape, enrichOpts);

    await prisma.product.update({
      where: { id: product.id },
      data: {
        descriptionHtml: enriched.descriptionHtml,
        productContext: JSON.stringify(enriched.productContext),
      },
    });
    await addJobLog(
      jobId,
      "info",
      `Phase 2: description enriched — ${enriched.productContext.extractedSpecs.length} spec(s), ${enriched.productContext.featureCallouts.length} callout(s)`,
    );
  } catch (err) {
    await addJobLog(
      jobId,
      "warn",
      `Phase 2: description enrichment failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 3) Optional variant curation.
  if (options.autoCurateVariants && product.variants.length > 1) {
    await addJobLog(jobId, "info", "Phase 2: auto-curating variants");
    try {
      // Reload variants in case any previous step changed them.
      const variants = await prisma.variant.findMany({
        where: { productId: product.id },
        orderBy: { position: "asc" },
      });

      const scrapedVariants = variants.map((v) => ({
        title: v.title,
        option1: v.option1 ?? undefined,
        option2: v.option2 ?? undefined,
        option3: v.option3 ?? undefined,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? undefined,
        supplierCost: v.supplierCost ?? undefined,
        ...(v.sku ? { sku: v.sku } : {}),
        ...(v.barcode ? { barcode: v.barcode } : {}),
        ...(v.weight !== null ? { weight: v.weight } : {}),
        ...(v.weightUnit
          ? { weightUnit: v.weightUnit as "g" | "kg" | "lb" | "oz" }
          : {}),
        ...(v.packagingDimensions
          ? { packagingDimensions: v.packagingDimensions }
          : {}),
        position: v.position,
        ...(v.sourceVariantId ? { sourceVariantId: v.sourceVariantId } : {}),
        ...(v.supplierLabel1 ? { supplierLabel1: v.supplierLabel1 } : {}),
        ...(v.supplierLabel2 ? { supplierLabel2: v.supplierLabel2 } : {}),
        ...(v.supplierLabel3 ? { supplierLabel3: v.supplierLabel3 } : {}),
      }));

      const curation = await autoCurateVariants(
        scrapedVariants,
        product.title,
        optionNames,
      );

      // Index original DB variants by position so we can locate the matching row.
      const dbByPos = new Map(variants.map((v) => [v.position, v]));

      // Drops → isHidden = true.
      for (const drop of curation.dropped) {
        const target = dbByPos.get(drop.variant.position);
        if (!target) continue;
        await prisma.variant.update({
          where: { id: target.id },
          data: { isHidden: true },
        });
      }

      // Renamed survivors → write new option1/2/3 + preserve original on supplierLabel*.
      for (const kept of curation.kept) {
        const target = dbByPos.get(kept.position);
        if (!target) continue;
        await prisma.variant.update({
          where: { id: target.id },
          data: {
            option1: kept.option1 ?? null,
            option2: kept.option2 ?? null,
            option3: kept.option3 ?? null,
            title: kept.title,
            supplierLabel1: kept.supplierLabel1 ?? target.supplierLabel1,
            supplierLabel2: kept.supplierLabel2 ?? target.supplierLabel2,
            supplierLabel3: kept.supplierLabel3 ?? target.supplierLabel3,
            isHidden: false,
          },
        });
      }

      // Persist potentially-renamed axis names.
      if (curation.optionNames.length > 0) {
        await prisma.product.update({
          where: { id: product.id },
          data: { optionNames: JSON.stringify(curation.optionNames) },
        });
        optionNames = curation.optionNames;
      }

      const summaryParts = [
        `${curation.kept.length} kept, ${curation.dropped.length} dropped, ${curation.renamed.length} renamed`,
      ];
      if (curation.summary) {
        if (curation.summary.axesKilled.length > 0) {
          const killed = curation.summary.axesKilled
            .map((k) =>
              k.defaultPicked
                ? `${k.axis} (default: ${k.defaultPicked})`
                : k.axis,
            )
            .join(", ");
          summaryParts.push(`axes killed: ${killed}`);
        }
        if (curation.summary.collapsedWithinAxis.length > 0) {
          const collapsed = curation.summary.collapsedWithinAxis
            .map(
              (c) =>
                `${c.axis}: kept "${c.kept}", merged [${c.merged.map((m) => `"${m}"`).join(", ")}]`,
            )
            .join("; ");
          summaryParts.push(`collapsed: ${collapsed}`);
        }
        if (curation.summary.noiseCutCount > 0) {
          summaryParts.push(`cut as noise: ${curation.summary.noiseCutCount}`);
        }
      }
      await addJobLog(
        jobId,
        "info",
        `Phase 2: curation done — ${summaryParts.join(" · ")}`,
      );
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 2: variant curation failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 4) Optional AI suggested pricing.
  if (options.suggestedPricing) {
    await addJobLog(jobId, "info", "Phase 2: computing suggested pricing");
    try {
      const rationale = await recalculatePricing(product.id, options);
      await applyPricingToVariants(product.id, "launch", options);
      const launch = rationale.ladder.find((t) => t.label === "launch");
      await addJobLog(
        jobId,
        "info",
        `Phase 2: pricing applied (launch=${launch?.price ?? "?"}, ${rationale.ladder.length} tier(s))`,
      );
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 2: suggested pricing failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 5) Run transformation rules in the canonical order.
  const RULE_ORDER: Array<"title" | "description" | "tags" | "image" | "seo"> = [
    "title",
    "description",
    "tags",
    "image",
    "seo",
  ];
  for (const category of RULE_ORDER) {
    if (!options.ruleToggles[category]) continue;
    try {
      await applyRulesByCategory(product.id, category, options);
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Phase 2: ${category} rules failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 6) Mark ready.
  await completeScrapeJob(jobId);
  await addJobLog(jobId, "info", "Phase 2: complete — job marked ready");

  // 7) Optional auto-upload to Shopify (failure does NOT fail the job).
  if (options.autoUpload && options.uploadConnectionId) {
    await addJobLog(
      jobId,
      "info",
      `Auto-upload: pushing to connection ${options.uploadConnectionId}`,
    );
    try {
      const record = await uploadProductToShopify(
        product.id,
        options.uploadConnectionId,
        options,
      );
      await addJobLog(
        jobId,
        "info",
        `Auto-upload: ${record.status} (Shopify product ${record.shopifyProductId ?? "n/a"})`,
      );
    } catch (err) {
      await addJobLog(
        jobId,
        "warn",
        `Auto-upload failed (job remains ready): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-registration with the processor.
// ---------------------------------------------------------------------------

/**
 * Backfill ProductImage rows so every variant sharing the same `option1`
 * value (typically color, on 1688) carries the swatch image. Returns the
 * number of rows inserted. Idempotent — variants that already have a linked
 * image are skipped.
 */
export async function fillSwatchesByOption1(productId: string): Promise<number> {
  const [linkedImages, allVariants, maxPosRow] = await Promise.all([
    prisma.productImage.findMany({
      where: { productId, variantId: { not: null } },
      orderBy: { position: "asc" },
    }),
    prisma.variant.findMany({
      where: { productId },
      select: { id: true, option1: true },
    }),
    prisma.productImage.aggregate({
      where: { productId },
      _max: { position: true },
    }),
  ]);

  if (linkedImages.length === 0) return 0;

  const variantById = new Map(allVariants.map((v) => [v.id, v]));
  const imageByOption1 = new Map<string, (typeof linkedImages)[number]>();
  for (const img of linkedImages) {
    if (!img.variantId) continue;
    const v = variantById.get(img.variantId);
    if (!v?.option1) continue;
    if (!imageByOption1.has(v.option1)) imageByOption1.set(v.option1, img);
  }

  const variantsWithImages = new Set(linkedImages.map((i) => i.variantId));
  let nextPosition = (maxPosRow._max.position ?? 0) + 1;
  // Sequential create + variant.update so we can set featuredImageId on each
  // sister to the newly-inserted row.
  let inserted = 0;
  for (const v of allVariants) {
    if (variantsWithImages.has(v.id)) continue;
    if (!v.option1) continue;
    const sister = imageByOption1.get(v.option1);
    if (!sister) continue;
    const newRow = await prisma.productImage.create({
      data: {
        productId,
        variantId: v.id,
        sourceUrl: sister.sourceUrl,
        storagePath: sister.storagePath,
        fileName: sister.fileName,
        altText: sister.altText,
        position: nextPosition++,
        width: sister.width,
        height: sister.height,
        downloadStatus: "downloaded",
      },
    });
    await prisma.variant.update({
      where: { id: v.id },
      data: { featuredImageId: newRow.id },
    });
    inserted++;
  }

  return inserted;
}

/**
 * Set `Variant.featuredImageId` for every variant that doesn't have one yet,
 * preferring a hero image, then any non-hero image linked to the variant.
 * Called at the end of Phase 1 to ensure freshly-scraped variants have a
 * featured image before users see the review page.
 */
async function setDefaultFeaturedImages(productId: string): Promise<number> {
  const variants = await prisma.variant.findMany({
    where: { productId, featuredImageId: null },
    select: { id: true },
  });
  if (variants.length === 0) return 0;

  let set = 0;
  for (const v of variants) {
    const candidate = await prisma.productImage.findFirst({
      where: {
        productId,
        variantId: v.id,
        OR: [{ imageType: "hero" }, { imageType: null }, { imageType: { not: "hero" } }],
      },
      orderBy: [{ imageType: "desc" }, { position: "asc" }], // "hero" sorts after null/source — flip below
    });
    if (!candidate) continue;
    // Prefer hero if present, otherwise just take the first match.
    const hero = await prisma.productImage.findFirst({
      where: { productId, variantId: v.id, imageType: "hero" },
      orderBy: { position: "asc" },
    });
    const picked = hero ?? candidate;
    await prisma.variant.update({
      where: { id: v.id },
      data: { featuredImageId: picked.id },
    });
    set++;
  }
  return set;
}

registerScrapeHandler(handleScrapeJob);
registerRulesHandler(handleRulesJob);
