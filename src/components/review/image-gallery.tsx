"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export interface GalleryImage {
  id: string;
  sourceUrl: string;
  variantId: string | null;
  altText: string | null;
  position: number;
  storagePath?: string | null;
  fileName?: string | null;
  imageType?: string | null;
}

interface VariantOption {
  id: string;
  label: string;
}

interface ImageGalleryProps {
  productId: string;
  images: GalleryImage[];
  variants?: VariantOption[];
  onChanged?: () => void;
}

async function patchImage(
  productId: string,
  imageId: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`/api/products/${productId}/images/${imageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `HTTP ${res.status}`);
  }
}

export function ImageGallery({
  productId,
  images,
  variants = [],
  onChanged,
}: ImageGalleryProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Dedupe by file (storagePath, then sourceUrl). Sister-variant rows share
  // the same Supabase file with different ids; the gallery should show ONE
  // tile per unique file. Keep the lowest-position row as the representative
  // so position-based ordering is stable.
  const dedupedImages = useMemo(() => {
    const sorted = [...images].sort((a, b) => a.position - b.position);
    const seen = new Map<string, GalleryImage>();
    for (const img of sorted) {
      const key = img.storagePath || img.sourceUrl;
      if (!seen.has(key)) seen.set(key, img);
    }
    return Array.from(seen.values());
  }, [images]);

  // Map storagePath → all sister-row IDs sharing that file. When the user
  // deletes a tile, we delete every sister row pointing at the same file so
  // the tile actually disappears (otherwise the next sister becomes the new
  // representative and the tile reappears on refresh).
  const sisterIdsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const img of images) {
      const key = img.storagePath || img.sourceUrl;
      const arr = map.get(key) ?? [];
      arr.push(img.id);
      map.set(key, arr);
    }
    return map;
  }, [images]);

  const [order, setOrder] = useState<GalleryImage[]>(() => dedupedImages);
  const [pending, setPending] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const lastImagesRef = useRef(images);

  // Re-sync local order if props change
  if (lastImagesRef.current !== images) {
    lastImagesRef.current = images;
    setOrder(dedupedImages);
  }

  const persistOrder = useCallback(
    async (newOrder: GalleryImage[]) => {
      // We update position field for each via PATCH (simple sequential).
      try {
        await Promise.all(
          newOrder.map((img, idx) =>
            patchImage(productId, img.id, { position: idx }),
          ),
        );
        onChanged?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reorder failed");
      }
    },
    [productId, onChanged],
  );

  function handleDragStart(id: string) {
    setDraggingId(id);
  }
  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>, id: string) {
    e.preventDefault();
    setDragOverId(id);
  }
  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    const fromIdx = order.findIndex((i) => i.id === draggingId);
    const toIdx = order.findIndex((i) => i.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...order];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);
    setDraggingId(null);
    setDragOverId(null);
    persistOrder(next);
  }

  async function setPrimary(id: string) {
    setPending(id);
    try {
      // The "primary" image convention is position 0. Reorder locally.
      const next = [
        ...order.filter((i) => i.id === id),
        ...order.filter((i) => i.id !== id),
      ];
      setOrder(next);
      await persistOrder(next);
      toast.success("Primary image updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(null);
    }
  }

  async function assignVariant(imageId: string, variantId: string | null) {
    setPending(imageId);
    try {
      await patchImage(productId, imageId, { variantId });
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(null);
    }
  }

  function toggleSelected(repId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(repId)) next.delete(repId);
      else next.add(repId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} image${selectedIds.size === 1 ? "" : "s"}? This also removes any sister rows pointing at the same file (so variants featuring this image will need a new pick).`,
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      // Build the full list of row IDs to delete (sister-aware): for each
      // selected representative, gather every row that shares its storagePath.
      const idsToDelete = new Set<string>();
      for (const repId of selectedIds) {
        const rep = order.find((o) => o.id === repId);
        if (!rep) continue;
        const key = rep.storagePath || rep.sourceUrl;
        const sisters = sisterIdsByKey.get(key) ?? [repId];
        for (const sid of sisters) idsToDelete.add(sid);
      }

      const results = await Promise.allSettled(
        Array.from(idsToDelete).map((id) =>
          fetch(`/api/products/${productId}/images/${id}`, { method: "DELETE" }),
        ),
      );
      const failed = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
      ).length;
      const ok = results.length - failed;

      if (ok > 0) {
        toast.success(`Deleted ${ok} image row${ok === 1 ? "" : "s"}`);
      }
      if (failed > 0) {
        toast.error(`${failed} delete${failed === 1 ? "" : "s"} failed`);
      }
      setSelectedIds(new Set());
      onChanged?.();
    } finally {
      setBulkDeleting(false);
    }
  }

  if (order.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No images downloaded yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>
            <strong>{selectedIds.size}</strong> image{selectedIds.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={bulkDeleting}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={bulkDelete}
              disabled={bulkDeleting}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {bulkDeleting
                ? "Deleting…"
                : `Delete selected (${selectedIds.size})`}
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {order.map((img, idx) => {
        const isDragging = draggingId === img.id;
        const isOver = dragOverId === img.id;
        const isPrimary = idx === 0;
        const isSelected = selectedIds.has(img.id);
        return (
          <div
            key={img.id}
            draggable
            onDragStart={() => handleDragStart(img.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, img.id)}
            onDrop={() => handleDrop(img.id)}
            className={cn(
              "group relative rounded-md border bg-card transition-all",
              isDragging && "opacity-50",
              isOver && "ring-2 ring-primary",
              isSelected && "ring-2 ring-destructive",
            )}
          >
            <div
              className="absolute right-1.5 top-1.5 z-10 rounded-md bg-background/90 p-0.5 shadow-sm backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleSelected(img.id)}
                aria-label="Select image for bulk delete"
              />
            </div>
            <div className="relative aspect-square overflow-hidden rounded-t-md bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.sourceUrl}
                alt={img.altText ?? `Image ${idx + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
                draggable={false}
              />
              {isPrimary && (
                <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  <Star className="h-3 w-3" /> primary
                </span>
              )}
              {/* Hover overlay: filename + alt text. Fades in on group hover.
                  Pointer-events-none so it doesn't block the checkbox / image
                  drag. Bottom-anchored gradient keeps the product visible at
                  the top of the tile while the metadata appears below. */}
              {(img.fileName || img.altText) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/80 via-black/55 to-transparent p-2 text-[10px] leading-tight text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none">
                  {img.fileName ? (
                    <div className="font-mono break-all">{img.fileName}</div>
                  ) : (
                    <div className="italic text-white/60">(no filename)</div>
                  )}
                  {img.altText ? (
                    <div className="text-white/85">{img.altText}</div>
                  ) : (
                    <div className="italic text-white/60">(no alt text)</div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2 p-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">#{idx + 1}</span>
                <Button
                  type="button"
                  size="xs"
                  variant={isPrimary ? "secondary" : "outline"}
                  onClick={() => setPrimary(img.id)}
                  disabled={isPrimary || pending === img.id}
                >
                  Set primary
                </Button>
              </div>
              {variants.length > 0 && (
                <div className="space-y-1">
                  <select
                    value={img.variantId ?? ""}
                    onChange={(e) =>
                      assignVariant(img.id, e.target.value || null)
                    }
                    disabled={pending === img.id}
                    className="h-7 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="">— No variant —</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  {img.variantId && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => assignVariant(img.id, null)}
                      disabled={pending === img.id}
                      className="w-full"
                    >
                      <X className="mr-1 h-3 w-3" /> Unassign
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
