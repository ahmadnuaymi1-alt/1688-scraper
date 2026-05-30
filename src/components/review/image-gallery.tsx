"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Star, Trash2, Upload, X } from "lucide-react";
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
  /** User flag: protect from "Delete originals" bulk action. */
  keep?: boolean;
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
  //
  // Also hide raw `imageType=hero` rows — these are the unprocessed Seedream
  // outputs that always get post-processed into `hero-flat`. The flat versions
  // are the user-facing finals; the raw heroes are intermediate artifacts only.
  const dedupedImages = useMemo(() => {
    const sorted = [...images]
      .filter((img) => img.imageType !== "hero")
      .sort((a, b) => a.position - b.position);
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
  // Anchor for shift+click range selection — index of the most recent tile
  // click plus which action (check / uncheck) was taken. A follow-up
  // shift+click extends that exact action to the inclusive range, matching
  // Shopify / Gmail behavior (uncheck the anchor then shift-click → range
  // gets unchecked; check then shift-click → range gets checked).
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [lastSelectedAction, setLastSelectedAction] = useState<"check" | "uncheck" | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOverFiles, setDragOverFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const f of list) formData.append("files", f);
      const res = await fetch(`/api/products/${productId}/images`, {
        method: "POST",
        body: formData,
      });
      const json = (await res.json().catch(() => ({}))) as {
        created?: unknown[];
        failed?: Array<{ name: string; error: string }>;
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error || `Upload failed (HTTP ${res.status})`);
        return;
      }
      const createdCount = json.created?.length ?? 0;
      const failedCount = json.failed?.length ?? 0;
      if (createdCount > 0) {
        toast.success(`Uploaded ${createdCount} image${createdCount === 1 ? "" : "s"}`);
      }
      if (failedCount > 0) {
        const firstReason = json.failed?.[0]?.error ?? "Unknown error";
        toast.error(`Skipped ${failedCount} file${failedCount === 1 ? "" : "s"}: ${firstReason}`);
      }
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    void uploadFiles(files);
    e.target.value = ""; // allow re-uploading the same file
  }

  function handleOuterDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragOverFiles(true);
  }
  function handleOuterDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    // Only clear when leaving the outermost wrapper (relatedTarget falls outside).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverFiles(false);
  }
  function handleOuterDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragOverFiles(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) void uploadFiles(files);
  }
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
    // If the drag is a file from outside the browser, let it bubble to the
    // outer wrapper's file-drop handler instead of treating the tile as a
    // reorder target. Without this guard the per-tile preventDefault would
    // swallow file drops.
    if (e.dataTransfer.types.includes("Files")) return;
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

  // Toggle the "keep when deleting originals" flag. Applied to ALL sister rows
  // sharing the same file, so the UI stays consistent with the dedup logic.
  async function toggleKeep(imageId: string, nextValue: boolean) {
    const rep = order.find((i) => i.id === imageId);
    if (!rep) return;
    const key = rep.storagePath || rep.sourceUrl;
    const sisterIds = sisterIdsByKey.get(key) ?? [imageId];
    setPending(imageId);
    try {
      await Promise.all(
        sisterIds.map((sid) =>
          patchImage(productId, sid, { keep: nextValue }),
        ),
      );
      // Local optimistic update so the star reflects immediately.
      setOrder((prev) =>
        prev.map((i) => (i.id === imageId ? { ...i, keep: nextValue } : i)),
      );
      toast.success(nextValue ? "Image starred to keep" : "Star removed");
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

  function handleTileClick(e: React.MouseEvent, idx: number, id: string) {
    // Ignore clicks that originated on an interactive control — buttons,
    // selects, the checkbox label, etc. — so opening the variant dropdown or
    // hitting "Set primary" doesn't also flip selection on the underlying tile.
    const t = e.target as HTMLElement;
    if (t.closest("button, select, input, a, label")) return;

    if (e.shiftKey && lastSelectedIdx !== null && lastSelectedAction !== null) {
      // Shift-extend: apply the SAME action (check or uncheck) we did on the
      // anchor to every tile in the inclusive range. Click #1 to check + shift-
      // click #7 → 1..7 all checked; uncheck #1 + shift-click #7 → 1..7 wiped.
      // Anchor stays put so the user can chain further shift-clicks from it.
      const [lo, hi] =
        lastSelectedIdx < idx ? [lastSelectedIdx, idx] : [idx, lastSelectedIdx];
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          if (lastSelectedAction === "check") next.add(order[i].id);
          else next.delete(order[i].id);
        }
        return next;
      });
      return;
    }

    // Plain click: toggle this tile, remember the resulting action so the
    // next shift+click knows which direction to fill.
    const willBeSelected = !selectedIds.has(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (willBeSelected) next.add(id);
      else next.delete(id);
      return next;
    });
    setLastSelectedIdx(idx);
    setLastSelectedAction(willBeSelected ? "check" : "uncheck");
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setLastSelectedIdx(null);
    setLastSelectedAction(null);
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

  return (
    <div
      className={cn(
        "relative space-y-3 rounded-md transition-all",
        dragOverFiles && "ring-2 ring-primary ring-offset-2",
      )}
      onDragOver={handleOuterDragOver}
      onDragLeave={handleOuterDragLeave}
      onDrop={handleOuterDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="mr-1 h-3 w-3" />
          {uploading ? "Uploading…" : "Upload images"}
        </Button>
      </div>
      {dragOverFiles && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md bg-primary/10">
          <span className="rounded-md bg-background px-4 py-2 text-sm font-medium shadow-sm">
            Drop to upload
          </span>
        </div>
      )}
      {order.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No images yet. Drop image files here or click <strong>Upload images</strong>.
        </p>
      )}
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
            onClick={(e) => handleTileClick(e, idx, img.id)}
            onDragStart={() => handleDragStart(img.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, img.id)}
            onDrop={() => handleDrop(img.id)}
            className={cn(
              "group relative cursor-pointer rounded-md border bg-card transition-all",
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
              {/* Keep-on-delete star toggle. Positioned bottom-left so it
                  doesn't clash with the "primary" badge or the select checkbox.
                  Filled = will survive a "Delete originals" run; outlined =
                  will be deleted. Click stops propagation so it doesn't toggle
                  the tile's bulk-select state. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleKeep(img.id, !img.keep);
                }}
                disabled={pending === img.id}
                title={
                  img.keep
                    ? "Starred — will be kept when deleting originals. Click to remove star."
                    : "Click to star — will survive 'Delete originals' bulk actions."
                }
                aria-label={img.keep ? "Remove keep star" : "Star to keep when deleting originals"}
                className="absolute bottom-1 left-1 z-10 inline-flex items-center justify-center rounded-full bg-background/85 p-1 shadow-sm backdrop-blur-sm transition hover:bg-background disabled:opacity-50"
              >
                <Star
                  className={cn(
                    "h-3.5 w-3.5 transition-colors",
                    img.keep ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground",
                  )}
                />
              </button>
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
