"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown, ChevronUp } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { toast } from "sonner";
import {
  VariantTable,
  type VariantTableItem,
  type VariantImageItem,
} from "./variant-table";
import {
  ImageGallery,
  type GalleryImage,
} from "./image-gallery";
import { PricingNotesCard } from "./pricing-notes-card";
import type { AiPricingRationale } from "@/types/pricing-rationale";

export interface ProductEditorConnection {
  id: string;
  label: string;
}

export interface ProductEditorData {
  id: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  tags: string | null;
  descriptionHtml: string | null;
  metaDescription: string | null;
  optionNames: string[];
  pricingNotes: AiPricingRationale | null;
  sourceUrl: string | null;
  variants: VariantTableItem[];
  images: GalleryImage[];
  connections?: ProductEditorConnection[];
  /** Next product scraped after this one (newer). Null when this is the most recent. */
  newerProductId?: string | null;
  /** Previous product scraped before this one (older). Null when this is the oldest. */
  olderProductId?: string | null;
}

interface ProductEditorProps {
  product: ProductEditorData;
}

export function ProductEditor({ product }: ProductEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(product.title);
  const [vendor, setVendor] = useState(product.vendor ?? "");
  const [productType, setProductType] = useState(product.productType ?? "");
  const [tags, setTags] = useState(product.tags ?? "");
  const [descriptionHtml, setDescriptionHtml] = useState(
    product.descriptionHtml ?? "",
  );
  const [metaDescription, setMetaDescription] = useState(
    product.metaDescription ?? "",
  );
  const [pricingNotes, setPricingNotes] = useState<AiPricingRationale | null>(
    product.pricingNotes,
  );
  const [saving, setSaving] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [reapplySelection, setReapplySelection] = useState<
    Record<string, boolean>
  >({
    description: false,
    title: false,
    seo: false,
    tags: false,
    image: false,
  });
  const [recalculating, setRecalculating] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    product.connections?.[0]?.id ?? "",
  );

  // Variant images derived from product.images so the VariantTable shows
  // assigned thumbnails.
  const variantImages: VariantImageItem[] = useMemo(
    () =>
      product.images.map((img) => ({
        id: img.id,
        sourceUrl: img.sourceUrl,
        variantId: img.variantId,
        altText: img.altText,
        storagePath: img.storagePath ?? null,
      })),
    [product.images],
  );

  const variantOptions = useMemo(
    () =>
      product.variants.map((v) => ({
        id: v.id,
        label:
          [v.option1, v.option2, v.option3].filter(Boolean).join(" / ") ||
          v.title,
      })),
    [product.variants],
  );

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  async function handleSave(opts: { silent?: boolean } = {}) {
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          vendor: vendor || null,
          productType: productType || null,
          tags: tags || null,
          descriptionHtml: descriptionHtml || null,
          metaDescription: metaDescription || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (!opts.silent) toast.success("Product saved");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Auto-save on blur for any Product-card field, silent (errors still toasted).
  // Fixes the "I edited and navigated away and it reverted" problem.
  const autoSave = () => handleSave({ silent: true });

  async function handleReapplyRules(categories?: readonly string[]) {
    setReapplying(true);
    try {
      const body =
        categories && categories.length > 0
          ? JSON.stringify({ categories })
          : undefined;
      const res = await fetch(
        `/api/products/${product.id}/reapply-rules`,
        {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body,
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(
        categories && categories.length > 0
          ? `Re-applied ${categories.length === 1 ? `${categories[0]} rule` : `${categories.length} rules (${categories.join(", ")})`}`
          : "Rules re-applied (all categories)",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-apply failed");
    } finally {
      setReapplying(false);
    }
  }

  async function handleRewriteDescription() {
    setRewriting(true);
    try {
      const res = await fetch(
        `/api/products/${product.id}/rewrite-description`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (typeof json.descriptionHtml === "string") {
        setDescriptionHtml(json.descriptionHtml);
      }
      toast.success(
        `Description rewritten (${json.liveVariantCount ?? 0} live variant${json.liveVariantCount === 1 ? "" : "s"})`,
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewriting(false);
    }
  }

  async function handleApplyGalleryPreset() {
    setApplyingPreset(true);
    try {
      const res = await fetch(
        `/api/products/${product.id}/apply-gallery-preset`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const parts: string[] = [];
      if (json.leadHeroImageId) parts.push("1 lead");
      if (json.lifestyleCount > 0) {
        parts.push(`${json.lifestyleCount} lifestyle${json.lifestyleCount === 1 ? "" : "s"}`);
      }
      if (json.trailingHeroCount > 0) {
        parts.push(`${json.trailingHeroCount} more hero${json.trailingHeroCount === 1 ? "" : "s"}`);
      }
      if (json.remainderCount > 0) {
        parts.push(`${json.remainderCount} other${json.remainderCount === 1 ? "" : "s"}`);
      }
      toast.success(
        parts.length > 0
          ? `Reordered ${json.totalImages} images — ${parts.join(", ")}`
          : `Reordered ${json.totalImages} images`,
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preset failed");
    } finally {
      setApplyingPreset(false);
    }
  }

  async function handleAutofillVariantImages() {
    setAutofilling(true);
    try {
      const res = await fetch(
        `/api/products/${product.id}/autofill-variant-images`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const filled = json.filled ?? 0;
      const skipped = json.skippedNoMatch ?? 0;
      if (filled === 0 && skipped === 0) {
        toast.success("Nothing to fill — every variant already has an image");
      } else if (filled === 0) {
        toast.message(
          `No fills made — ${skipped} variant${skipped === 1 ? "" : "s"} had no candidate matching ≥ ${json.threshold ?? "threshold"} axes`,
        );
      } else {
        toast.success(
          `Filled ${filled} variant${filled === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} skipped — no close match)` : ""}`,
        );
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Autofill failed");
    } finally {
      setAutofilling(false);
    }
  }

  async function handleRecalculatePricing() {
    setRecalculating(true);
    try {
      const res = await fetch(
        `/api/products/${product.id}/recalculate-pricing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (json.pricingNotes) {
        setPricingNotes(json.pricingNotes as AiPricingRationale);
      }
      toast.success("Pricing recalculated");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recalculate failed");
    } finally {
      setRecalculating(false);
    }
  }

  async function handleUpload() {
    if (!selectedConnectionId) {
      toast.error("Select a Shopify connection first");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          connectionId: selectedConnectionId,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success("Upload queued");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const connections = product.connections ?? [];

  return (
    <div className="space-y-6">
      {/* Action toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {title || "Untitled product"}
          </h1>
          {product.sourceUrl && (
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block max-w-2xl truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              title={product.sourceUrl}
            >
              Source: {product.sourceUrl}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Prev/next nav across the user's scraped products, ordered by
              scrape date (newest first). Up = newer, Down = older. */}
          <div className="mr-1 flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!product.newerProductId}
              onClick={() =>
                product.newerProductId &&
                router.push(`/review/${product.newerProductId}`)
              }
              title={
                product.newerProductId
                  ? "Newer product (scraped after this one)"
                  : "No newer product"
              }
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!product.olderProductId}
              onClick={() =>
                product.olderProductId &&
                router.push(`/review/${product.olderProductId}`)
              }
              title={
                product.olderProductId
                  ? "Older product (scraped before this one)"
                  : "No older product"
              }
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={reapplying}
                title="Re-run AI rules — pick All, or just one category (e.g. Image after generating heroes/lifestyles)."
              >
                {reapplying ? "Re-applying…" : "Re-apply rules"}
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="end">
              <button
                type="button"
                className="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-50"
                onClick={() => handleReapplyRules()}
                disabled={reapplying}
              >
                All categories
              </button>
              <div className="my-1 h-px bg-border" />
              <div className="space-y-1 px-1 py-1">
                {(["description", "title", "seo", "tags", "image"] as const).map(
                  (cat) => (
                    <label
                      key={cat}
                      className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm transition-colors"
                    >
                      <Checkbox
                        checked={reapplySelection[cat] === true}
                        onCheckedChange={(v) =>
                          setReapplySelection((prev) => ({
                            ...prev,
                            [cat]: v === true,
                          }))
                        }
                        disabled={reapplying}
                      />
                      <span className="capitalize">{cat}</span>
                    </label>
                  ),
                )}
              </div>
              <div className="my-1 h-px bg-border" />
              {(() => {
                const selected = Object.entries(reapplySelection)
                  .filter(([, v]) => v)
                  .map(([k]) => k);
                return (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={reapplying || selected.length === 0}
                    onClick={() => handleReapplyRules(selected)}
                  >
                    {reapplying
                      ? "Re-applying…"
                      : selected.length === 0
                        ? "Pick at least one"
                        : `Apply ${selected.length} selected`}
                  </Button>
                );
              })()}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRewriteDescription}
            disabled={rewriting}
            title="Regenerate the description from the cached enrichment data + your current live variants. Does not re-OCR."
          >
            {rewriting ? "Rewriting…" : "Rewrite description"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculatePricing}
            disabled={recalculating}
          >
            {recalculating ? "Recalculating…" : "Recalculate pricing"}
          </Button>
          {connections.length > 0 ? (
            <>
              <Select
                value={selectedConnectionId}
                onValueChange={setSelectedConnectionId}
              >
                <SelectTrigger size="sm" className="min-w-40">
                  <SelectValue placeholder="Pick connection" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={uploading || !selectedConnectionId}
              >
                {uploading ? "Uploading…" : "Upload to Shopify"}
              </Button>
            </>
          ) : (
            <Button size="sm" disabled title="No Shopify connections">
              Upload to Shopify
            </Button>
          )}
          <Button size="sm" onClick={() => handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Core fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={autoSave}
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Tabs defaultValue="preview" className="w-full">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="html">HTML</TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="mt-2">
                <div
                  className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-background px-4 py-3 min-h-[16rem]"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(descriptionHtml || "<p class=\"text-muted-foreground italic\">(no description)</p>"),
                  }}
                />
              </TabsContent>
              <TabsContent value="html" className="mt-2">
                <Textarea
                  id="descriptionHtml"
                  value={descriptionHtml}
                  onChange={(e) => setDescriptionHtml(e.target.value)}
                  onBlur={autoSave}
                  rows={14}
                  className="font-mono text-xs"
                />
              </TabsContent>
            </Tabs>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor</Label>
              <Input
                id="vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                onBlur={autoSave}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="productType">Product Type</Label>
              <Input
                id="productType"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                onBlur={autoSave}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={autoSave}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="metaDescription">Meta description</Label>
            <Textarea
              id="metaDescription"
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              onBlur={autoSave}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      {pricingNotes && (
        <PricingNotesCard
          productId={product.id}
          productTitle={title}
          pricingNotes={pricingNotes}
          onUpdated={setPricingNotes}
        />
      )}

      {/* Variants */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Variants</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutofillVariantImages}
            disabled={autofilling}
            title="Fill empty variant images by matching option values against variants that already have one. Same-design same-finish wins; capacity-only differences are ignored."
          >
            {autofilling ? "Filling…" : "Auto-fill images"}
          </Button>
        </CardHeader>
        <CardContent>
          <VariantTable
            variants={product.variants}
            optionNames={product.optionNames}
            productId={product.id}
            images={variantImages}
            onVariantsChanged={refresh}
            onVariantsReordered={refresh}
          />
        </CardContent>
      </Card>

      {/* Images */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Images</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleApplyGalleryPreset}
            disabled={applyingPreset}
            title="Reorder the gallery into the Shopify-ready preset: lead variant's hero first, then all lifestyle images, then the remaining variant heroes in row order. Persists to DB (Shopify upload will see this order too)."
          >
            {applyingPreset ? "Applying…" : "Apply preset order"}
          </Button>
        </CardHeader>
        <CardContent>
          <ImageGallery
            productId={product.id}
            images={product.images}
            variants={variantOptions}
            onChanged={refresh}
          />
        </CardContent>
      </Card>
    </div>
  );
}
