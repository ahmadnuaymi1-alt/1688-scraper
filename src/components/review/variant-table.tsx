"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  createContext,
  useContext,
  forwardRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  Trash2,
  Pencil,
  X,
  Eye,
  EyeOff,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWeightLb, convertPkgDimsStringToInches } from "@/lib/units";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Shape used by the table — flat fields matching the Prisma Variant model
// (plus an optional `isHidden` flag from the new schema).
export interface VariantTableItem {
  id: string;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  barcode: string | null;
  weight: number | null;
  weightUnit: string | null;
  packagingDimensions: string | null;
  position: number;
  isHidden?: boolean;
  featuredImageId?: string | null;
}

export interface VariantImageItem {
  id: string;
  sourceUrl: string;
  variantId: string | null;
  altText: string | null;
  storagePath?: string | null;
}

interface VariantTableProps {
  variants: VariantTableItem[];
  optionNames?: string[];
  productId?: string;
  onVariantsReordered?: () => void;
  onVariantsChanged?: () => void;
  images?: VariantImageItem[];
  selectedVariantId?: string | null;
  onVariantClick?: (variantId: string) => void;
}

type SortDir = "none" | "asc" | "desc";

type EditableField =
  | "price"
  | "compareAtPrice"
  | "sku"
  | "barcode"
  | "option1"
  | "option2"
  | "option3";

const BULK_EDIT_FIELDS: { key: EditableField; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "compareAtPrice", label: "Compare At Price" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
];

/**
 * Detect which sort (if any) the current variant order corresponds to.
 *
 * Walks each axis (0..2) plus price, asks: is the array monotonically
 * non-decreasing on this dimension (ASC)? Non-increasing (DESC)? If exactly
 * one direction matches AND the dimension has at least 2 distinct values,
 * we report it. Returns the first axis to match in axis-index order; falls
 * through to price; falls through to neutral.
 *
 * Drives the column-header sort indicator so it always agrees with the real
 * variant order (regardless of how that order was set).
 */
function detectSortState(variants: VariantTableItem[]): {
  priceSort: SortDir;
  axisSort: { axisIndex: 0 | 1 | 2; direction: "asc" | "desc" } | null;
} {
  if (variants.length < 2) return { priceSort: "none", axisSort: null };

  const normSlot = (s: string | null): string | null => {
    if (!s) return null;
    const t = s.trim().toLowerCase();
    return t === "" ? null : t;
  };

  for (let axisIdx = 0; axisIdx <= 2; axisIdx++) {
    const values = variants.map((v) =>
      normSlot([v.option1, v.option2, v.option3][axisIdx]),
    );
    const distinct = new Set(values);
    distinct.delete(null);
    if (distinct.size < 2) continue;

    let isAsc = true;
    let isDesc = true;
    for (let i = 1; i < values.length; i++) {
      const a = values[i - 1];
      const b = values[i];
      if (a === null || b === null) continue;
      const cmp = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
      if (cmp > 0) isAsc = false;
      if (cmp < 0) isDesc = false;
      if (!isAsc && !isDesc) break;
    }
    if (isAsc && !isDesc) {
      return {
        axisSort: { axisIndex: axisIdx as 0 | 1 | 2, direction: "asc" },
        priceSort: "none",
      };
    }
    if (isDesc && !isAsc) {
      return {
        axisSort: { axisIndex: axisIdx as 0 | 1 | 2, direction: "desc" },
        priceSort: "none",
      };
    }
  }

  const prices = variants.map((v) => parseFloat(v.price));
  const distinctPrices = new Set(prices.filter((p) => !Number.isNaN(p)));
  if (distinctPrices.size >= 2) {
    let isAsc = true;
    let isDesc = true;
    for (let i = 1; i < prices.length; i++) {
      const a = prices[i - 1];
      const b = prices[i];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      if (a > b) isAsc = false;
      if (a < b) isDesc = false;
      if (!isAsc && !isDesc) break;
    }
    if (isAsc && !isDesc) return { priceSort: "asc", axisSort: null };
    if (isDesc && !isAsc) return { priceSort: "desc", axisSort: null };
  }

  return { priceSort: "none", axisSort: null };
}

export function VariantTable({
  variants,
  optionNames,
  productId,
  onVariantsReordered,
  onVariantsChanged,
  images = [],
  selectedVariantId,
  onVariantClick,
}: VariantTableProps) {
  // Sort indicator is DERIVED from the variants array (which arrives from the
  // server in current DB position order). We seed state from the derivation
  // so the click handlers can cycle direction optimistically; a useEffect
  // below re-syncs after every prop change. No localStorage — the indicator
  // can never disagree with the actual data this way.
  const detectedSort = useMemo(() => detectSortState(variants), [variants]);
  const [priceSort, setPriceSort] = useState<SortDir>(detectedSort.priceSort);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{
    variantId: string;
    field: EditableField;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Bulk edit dialog state
  const [bulkEditField, setBulkEditField] = useState<EditableField | null>(null);
  const [bulkEditValue, setBulkEditValue] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Delete confirmation dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Manual reorder state
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [reordering, setReordering] = useState(false);

  // Hide/unhide busy
  const [togglingHide, setTogglingHide] = useState<string | null>(null);
  const [bulkHiding, setBulkHiding] = useState(false);

  // Anchor index for Shopify-style shift-click range selection.
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);

  // Axis sort state, seeded from the derived detection. Cycles ASC → DESC
  // → null on click; written back to DB by cycleAxisSort below.
  const [axisSort, setAxisSort] = useState<{
    axisIndex: 0 | 1 | 2;
    direction: "asc" | "desc";
  } | null>(detectedSort.axisSort);

  // Re-sync sort state from data whenever the variants prop changes (which
  // happens after every successful reorder PATCH because the parent calls
  // router.refresh()). If a PATCH failed, the data didn't change and state
  // snaps back to match — preventing the indicator from showing a sort that
  // isn't actually applied.
  useEffect(() => {
    setPriceSort(detectedSort.priceSort);
    setAxisSort(detectedSort.axisSort);
  }, [detectedSort]);

  const sortedVariants = useMemo(() => {
    if (priceSort === "none") return variants;
    return [...variants].sort((a, b) => {
      const diff = parseFloat(a.price) - parseFloat(b.price);
      return priceSort === "asc" ? diff : -diff;
    });
  }, [variants, priceSort]);

  // Unique product images for the featured-image picker — dedupe by
  // storagePath (or sourceUrl as fallback). Sister variants reference the
  // same file via duplicate ProductImage rows; the picker should show one
  // tile per actual file.
  const dedupedImages = useMemo(() => {
    const seen = new Map<string, VariantImageItem>();
    for (const img of images) {
      const key = img.storagePath || img.sourceUrl;
      if (!seen.has(key)) seen.set(key, img);
    }
    return Array.from(seen.values());
  }, [images]);

  // Every original ProductImage.id → its representative deduped image. This
  // lets the picker resolve a variant's `featuredImageId` even when that
  // specific row is a sister-row that got deduped out of the grid.
  const imageIdToRepresentative = useMemo(() => {
    const repByKey = new Map<string, VariantImageItem>();
    for (const rep of dedupedImages) {
      const key = rep.storagePath || rep.sourceUrl;
      repByKey.set(key, rep);
    }
    const lookup = new Map<string, VariantImageItem>();
    for (const img of images) {
      const key = img.storagePath || img.sourceUrl;
      const rep = repByKey.get(key);
      if (rep) lookup.set(img.id, rep);
    }
    return lookup;
  }, [images, dedupedImages]);

  // Map variantId -> images assigned to that variant
  const variantImagesMap = useMemo(() => {
    const map = new Map<string, VariantImageItem[]>();
    for (const img of images) {
      if (img.variantId) {
        const existing = map.get(img.variantId) || [];
        existing.push(img);
        map.set(img.variantId, existing);
      }
    }
    return map;
  }, [images]);

  const displayVariants = useMemo(() => {
    if (manualOrder) {
      const idMap = new Map(sortedVariants.map((v) => [v.id, v]));
      return manualOrder
        .map((id) => idMap.get(id))
        .filter(Boolean) as typeof sortedVariants;
    }
    return sortedVariants;
  }, [sortedVariants, manualOrder]);

  // Reset manual order when price sort changes
  useEffect(() => {
    if (priceSort !== "none") setManualOrder(null);
  }, [priceSort]);

  // Clear selection when variants change
  useEffect(() => {
    setSelectedIds((prev) => {
      const variantIdSet = new Set(variants.map((v) => v.id));
      const filtered = new Set([...prev].filter((id) => variantIdSet.has(id)));
      if (filtered.size !== prev.size) return filtered;
      return prev;
    });
  }, [variants]);

  // Focus inline edit input when it appears
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Shopify-style shift-click range selection. `index` is the position of the
  // clicked row in the CURRENTLY DISPLAYED order. If shift is held and we have
  // a previous anchor, select every row between the anchor and the new index
  // (inclusive). Otherwise toggle just this row and set it as the new anchor.
  const handleRowCheckClick = useCallback(
    (index: number, shiftHeld: boolean, currentDisplayList: VariantTableItem[]) => {
      if (shiftHeld && lastCheckedIndex !== null) {
        const lo = Math.min(lastCheckedIndex, index);
        const hi = Math.max(lastCheckedIndex, index);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            const v = currentDisplayList[i];
            if (v) next.add(v.id);
          }
          return next;
        });
      } else {
        const v = currentDisplayList[index];
        if (v) toggleSelect(v.id);
        setLastCheckedIndex(index);
      }
    },
    [lastCheckedIndex, toggleSelect],
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === variants.length) return new Set();
      return new Set(variants.map((v) => v.id));
    });
  }, [variants]);

  // Save a single inline edit. Previously failed silently — both !res.ok and
  // network errors. Now surfaces a toast so the user knows the value did NOT
  // persist (the input stays open in edit mode so they can retry or escape).
  const saveInlineEdit = useCallback(async () => {
    if (!editingCell || !productId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [
            {
              id: editingCell.variantId,
              [editingCell.field]: editValue === "" ? null : editValue,
            },
          ],
        }),
      });
      if (res.ok) {
        setEditingCell(null);
        onVariantsChanged?.();
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(
          (json && typeof json.error === "string" && json.error) ||
            `Save failed (HTTP ${res.status})`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [editingCell, editValue, productId, onVariantsChanged]);

  // Bulk edit: apply value to all selected variants
  const applyBulkEdit = useCallback(async () => {
    if (!bulkEditField || !productId || selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      const updates = [...selectedIds].map((id) => ({
        id,
        [bulkEditField]: bulkEditValue === "" ? null : bulkEditValue,
      }));
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (res.ok) {
        setBulkEditField(null);
        setBulkEditValue("");
        onVariantsChanged?.();
      }
    } catch {
      // silent fail
    } finally {
      setBulkSaving(false);
    }
  }, [bulkEditField, bulkEditValue, selectedIds, productId, onVariantsChanged]);

  // Bulk delete selected variants
  const deleteSelected = useCallback(async () => {
    if (!productId || selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantIds: [...selectedIds] }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setShowDeleteDialog(false);
        onVariantsChanged?.();
      }
    } catch {
      // silent fail
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, productId, onVariantsChanged]);

  // Toggle hidden flag for a single variant. Uses the singular shape:
  // `{ variantId, isHidden }`. (The bulk shape `{ updates: [] }` is used by
  // bulkSetHidden below.)
  const toggleHidden = useCallback(
    async (variantId: string, currentHidden: boolean) => {
      if (!productId) return;
      setTogglingHide(variantId);
      try {
        const res = await fetch(`/api/products/${productId}/variants`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId,
            isHidden: !currentHidden,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        onVariantsChanged?.();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to toggle visibility",
        );
      } finally {
        setTogglingHide(null);
      }
    },
    [productId, onVariantsChanged],
  );

  // Bulk hide / unhide the currently-selected variants.
  const bulkSetHidden = useCallback(
    async (hidden: boolean) => {
      if (!productId || selectedIds.size === 0) return;
      setBulkHiding(true);
      try {
        const updates = Array.from(selectedIds).map((id) => ({ id, isHidden: hidden }));
        const res = await fetch(`/api/products/${productId}/variants`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        toast.success(
          `${hidden ? "Hid" : "Unhid"} ${updates.length} variant${updates.length === 1 ? "" : "s"}`,
        );
        onVariantsChanged?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Bulk update failed");
      } finally {
        setBulkHiding(false);
      }
    },
    [productId, selectedIds, onVariantsChanged],
  );

  if (variants.length === 0) {
    return <p className="text-muted-foreground text-sm">No variants found.</p>;
  }

  const hasOption2 = variants.some((v) => v.option2);
  const hasOption3 = variants.some((v) => v.option3);
  const hasSku = variants.some((v) => v.sku);
  const hasBarcode = variants.some((v) => v.barcode);
  const hasWeight = variants.some((v) => v.weight !== null);
  const hasPkgDimensions = variants.some((v) => v.packagingDimensions);
  const hasImages = images.length > 0;

  const option1Name = optionNames?.[0] || "Option 1";
  const option2Name = optionNames?.[1] || "Option 2";
  const option3Name = optionNames?.[2] || "Option 3";

  function cyclePriceSort() {
    setPriceSort((prev) =>
      prev === "none" ? "asc" : prev === "asc" ? "desc" : "none",
    );
    setApplied(false);
  }

  async function applySort() {
    if (!productId) return;
    setApplying(true);
    try {
      const variantOrder = displayVariants.map((v) => v.id);
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantOrder }),
      });
      if (res.ok) {
        setApplied(true);
        onVariantsReordered?.();
      }
    } catch {
      // Silent fail
    } finally {
      setApplying(false);
    }
  }

  /**
   * Click an option axis column header to cycle: unsorted → asc → desc →
   * unsorted. Computes the new variant order, sets manualOrder so the table
   * displays it instantly, and persists the new `position` values to the DB
   * (so Shopify upload + reload see the same order).
   */
  async function cycleAxisSort(axisIndex: 0 | 1 | 2) {
    let next: { axisIndex: 0 | 1 | 2; direction: "asc" | "desc" } | null;
    if (axisSort?.axisIndex === axisIndex) {
      next =
        axisSort.direction === "asc"
          ? { axisIndex, direction: "desc" }
          : null;
    } else {
      next = { axisIndex, direction: "asc" };
    }
    setAxisSort(next);

    if (!next) {
      // User cycled back to "no axis sort" — keep current manualOrder as-is
      // (don't restore original; user can use up/down or sort another axis).
      return;
    }

    // Sort by option[axisIndex] case-insensitive, locale-aware. Variants with
    // a null value on that axis sink to the end regardless of direction.
    const getKey = (v: VariantTableItem): string | null => {
      const slot = [v.option1, v.option2, v.option3][next.axisIndex];
      return slot && slot.trim() ? slot : null;
    };
    const sorted = [...variants].sort((a, b) => {
      const ka = getKey(a);
      const kb = getKey(b);
      if (ka === null && kb === null) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      const cmp = ka.localeCompare(kb, undefined, { sensitivity: "base", numeric: true });
      return next.direction === "asc" ? cmp : -cmp;
    });
    const reordered = sorted.map((v) => v.id);
    setManualOrder(reordered);
    setPriceSort("none");

    if (!productId) return;
    setReordering(true);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantOrder: reordered }),
      });
      if (res.ok) {
        onVariantsReordered?.();
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(
          (json && typeof json.error === "string" && json.error) ||
            `Sort save failed (HTTP ${res.status})`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sort save failed");
    } finally {
      setReordering(false);
    }
  }

  /**
   * Common path used by both `moveVariant` (up/down arrows) and `handleDragEnd`
   * (drag handle): given a new array of variant IDs, set local state +
   * persist to DB. Bails if no productId (component used in read-only mode).
   */
  const persistOrder = useCallback(
    async (reordered: string[]) => {
      setManualOrder(reordered);
      setPriceSort("none");
      setAxisSort(null);
      if (!productId) return;
      setReordering(true);
      try {
        const res = await fetch(`/api/products/${productId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantOrder: reordered }),
        });
        if (res.ok) {
          onVariantsReordered?.();
        } else {
          const json = await res.json().catch(() => ({}));
          toast.error(
            (json && typeof json.error === "string" && json.error) ||
              `Reorder save failed (HTTP ${res.status})`,
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reorder save failed");
      } finally {
        setReordering(false);
      }
    },
    [productId, onVariantsReordered],
  );

  // @dnd-kit sensors: pointer-drag with a small activation distance so a click
  // on cells doesn't accidentally start a drag, plus keyboard fallback.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const current = manualOrder || displayVariants.map((v) => v.id);
      const fromIndex = current.indexOf(String(active.id));
      const toIndex = current.indexOf(String(over.id));
      if (fromIndex < 0 || toIndex < 0) return;
      const next = [...current];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, String(active.id));
      void persistOrder(next);
    },
    [manualOrder, displayVariants, persistOrder],
  );

  async function moveVariant(index: number, direction: "up" | "down") {
    const current = manualOrder || sortedVariants.map((v) => v.id);
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= current.length) return;

    const reordered = [...current];
    [reordered[index], reordered[newIndex]] = [
      reordered[newIndex],
      reordered[index],
    ];
    setManualOrder(reordered);
    setPriceSort("none");

    // Persist to API
    if (!productId) return;
    setReordering(true);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantOrder: reordered }),
      });
      if (res.ok) {
        onVariantsReordered?.();
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(
          (json && typeof json.error === "string" && json.error) ||
            `Move failed (HTTP ${res.status})`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Move failed");
    } finally {
      setReordering(false);
    }
  }

  function startEditing(
    variantId: string,
    field: EditableField,
    currentValue: string | null,
  ) {
    setEditingCell({ variantId, field });
    setEditValue(currentValue || "");
  }

  function cancelEditing() {
    setEditingCell(null);
    setEditValue("");
  }

  function openBulkEdit(field: EditableField) {
    setBulkEditField(field);
    setBulkEditValue("");
  }

  const SortIcon =
    priceSort === "asc" ? ArrowUp : priceSort === "desc" ? ArrowDown : ArrowUpDown;

  const MAX_THUMBNAILS = 3;
  const allSelected =
    selectedIds.size === variants.length && variants.length > 0;
  const someSelected = selectedIds.size > 0;

  // Render an editable cell — inline input or display value
  function renderEditableCell(
    variant: VariantTableItem,
    field: EditableField,
    value: string | null,
    options?: { prefix?: string; mono?: boolean; className?: string },
  ) {
    const isEditing =
      editingCell?.variantId === variant.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <Input
          ref={editInputRef}
          className="h-7 w-full min-w-[60px] text-sm"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveInlineEdit();
            }
            if (e.key === "Escape") cancelEditing();
          }}
          onBlur={saveInlineEdit}
          disabled={saving}
        />
      );
    }

    const displayValue = value ? `${options?.prefix || ""}${value}` : "-";

    return (
      <span
        className={cn(
          "hover:bg-muted cursor-pointer rounded px-1 py-0.5",
          options?.mono && "font-mono",
          options?.className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (productId) startEditing(variant.id, field, value);
        }}
        title="Click to edit"
      >
        {displayValue}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      {/* Bulk action toolbar */}
      {someSelected && productId && (
        <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md border p-2">
          <span className="text-sm font-medium">
            {selectedIds.size} of {variants.length} selected
          </span>
          <div className="bg-border mx-1 h-4 w-px" />
          {BULK_EDIT_FIELDS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant="outline"
              onClick={() => openBulkEdit(f.key)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              {f.label}
            </Button>
          ))}
          {(() => {
            // Compute whether the selection is uniform (all hidden / all visible)
            // so we can show the right button.
            const selected = displayVariants.filter((v) => selectedIds.has(v.id));
            const allHidden = selected.every((v) => v.isHidden === true);
            const allVisible = selected.every((v) => v.isHidden !== true);
            return (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bulkSetHidden(true)}
                  disabled={bulkHiding || allHidden}
                  title={allHidden ? "All selected are already hidden" : "Hide selected"}
                >
                  <EyeOff className="mr-1 h-3 w-3" />
                  {bulkHiding ? "..." : "Hide"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bulkSetHidden(false)}
                  disabled={bulkHiding || allVisible}
                  title={allVisible ? "All selected are already visible" : "Unhide selected"}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  {bulkHiding ? "..." : "Unhide"}
                </Button>
              </>
            );
          })()}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedIds(new Set());
              setLastCheckedIndex(null);
            }}
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

      {/* Sort order toolbar */}
      {priceSort !== "none" && productId && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={applied ? "outline" : "default"}
            onClick={applySort}
            disabled={applying || applied}
          >
            {applied ? (
              <>
                <Check className="mr-1 h-3 w-3" /> Order applied
              </>
            ) : applying ? (
              "Applying..."
            ) : (
              "Apply sort order"
            )}
          </Button>
          <span className="text-muted-foreground text-xs">
            Saves this order for Shopify upload
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        {/* DndContext lives OUTSIDE <Table>. It renders a live-region <div>
            for screen-reader announcements; nesting a <div> inside <table>
            is invalid HTML and triggers a hydration error. SortableContext is
            a pure Context.Provider (no DOM) so it stays inside the table. */}
        {/* `id` is mandatory to stabilize the screen-reader announcer ID
            across SSR / hydration. Without it, @dnd-kit autogenerates a fresh
            ID each render, so the `aria-describedby` server-rendered onto
            each row differs from the client-rendered one and React throws a
            hydration mismatch. */}
        <DndContext
          id="variant-table-dnd"
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
        <Table>
          <TableHeader>
            <TableRow>
              {productId && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all variants"
                  />
                </TableHead>
              )}
              <TableHead className="w-12">#</TableHead>
              <AxisSortHead
                axisIndex={0}
                name={option1Name}
                axisSort={axisSort}
                onCycle={cycleAxisSort}
              />
              {hasOption2 && (
                <AxisSortHead
                  axisIndex={1}
                  name={option2Name}
                  axisSort={axisSort}
                  onCycle={cycleAxisSort}
                />
              )}
              {hasOption3 && (
                <AxisSortHead
                  axisIndex={2}
                  name={option3Name}
                  axisSort={axisSort}
                  onCycle={cycleAxisSort}
                />
              )}
              <TableHead
                className="hover:text-foreground cursor-pointer text-right select-none"
                onClick={cyclePriceSort}
              >
                <span className="inline-flex items-center gap-1">
                  Price <SortIcon className="h-3 w-3" />
                </span>
              </TableHead>
              <TableHead className="text-right">Compare At</TableHead>
              {hasSku && <TableHead>SKU</TableHead>}
              {hasBarcode && <TableHead>Barcode</TableHead>}
              {hasWeight && <TableHead>Pkg Weight</TableHead>}
              {hasPkgDimensions && <TableHead>Pkg Dims</TableHead>}
              {hasImages && <TableHead className="text-right">Images</TableHead>}
              {productId && <TableHead className="w-10 text-right" />}
            </TableRow>
          </TableHeader>
          <SortableContext
            items={displayVariants.map((v) => v.id)}
            strategy={verticalListSortingStrategy}
          >
          <TableBody>
            {displayVariants.map((v, i) => {
              const isSelected = selectedVariantId === v.id;
              const isChecked = selectedIds.has(v.id);
              const assignedImages = variantImagesMap.get(v.id) || [];
              const overflowCount = Math.max(
                0,
                assignedImages.length - MAX_THUMBNAILS,
              );
              const hidden = v.isHidden === true;

              return (
                <SortableTableRow
                  key={v.id}
                  id={v.id}
                  className={cn(
                    onVariantClick && "cursor-pointer",
                    isSelected && "bg-primary/5",
                    isChecked && "bg-muted/40",
                    hidden && "opacity-50",
                  )}
                  onClick={() => onVariantClick?.(v.id)}
                >
                  {productId && (
                    <TableCell
                      className="pr-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Wrap the checkbox so we can capture e.shiftKey for
                          range-select — Radix's onCheckedChange does not give
                          us the original mouse event. Important: the inner
                          Checkbox already toggles via onCheckedChange, so the
                          wrapper must NOT call toggleSelect on a plain click
                          (would double-toggle and cancel out). Wrapper only
                          handles the shift-extend case. */}
                      <div
                        role="presentation"
                        onClick={(e) => {
                          if (e.shiftKey && lastCheckedIndex !== null) {
                            handleRowCheckClick(i, true, displayVariants);
                          } else {
                            // Remember this row as the anchor for the next
                            // shift-click. The inner Checkbox handles the
                            // actual toggle via onCheckedChange.
                            setLastCheckedIndex(i);
                          }
                        }}
                      >
                        <Checkbox
                          checked={isChecked}
                          aria-label={`Select ${v.option1 || v.title}`}
                          onCheckedChange={() => toggleSelect(v.id)}
                        />
                      </div>
                    </TableCell>
                  )}
                  <TableCell
                    className="text-muted-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-0.5">
                      {productId && <DragHandle disabled={reordering} />}
                      <span className="w-4 text-center">{i + 1}</span>
                      {productId && (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            disabled={i === 0 || reordering}
                            onClick={() => moveVariant(i, "up")}
                            className="text-muted-foreground hover:text-foreground p-0 leading-none disabled:opacity-20"
                            aria-label="Move up"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={
                              i === displayVariants.length - 1 || reordering
                            }
                            onClick={() => moveVariant(i, "down")}
                            className="text-muted-foreground hover:text-foreground p-0 leading-none disabled:opacity-20"
                            aria-label="Move down"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {renderEditableCell(v, "option1", v.option1 || v.title)}
                  </TableCell>
                  {hasOption2 && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {renderEditableCell(v, "option2", v.option2)}
                    </TableCell>
                  )}
                  {hasOption3 && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {renderEditableCell(v, "option3", v.option3)}
                    </TableCell>
                  )}
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renderEditableCell(v, "price", v.price, {
                      prefix: "$",
                      mono: true,
                    })}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renderEditableCell(v, "compareAtPrice", v.compareAtPrice, {
                      prefix: "$",
                      mono: true,
                      className: "text-muted-foreground",
                    })}
                  </TableCell>
                  {hasSku && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {renderEditableCell(v, "sku", v.sku, {
                        mono: true,
                        className: "text-xs",
                      })}
                    </TableCell>
                  )}
                  {hasBarcode && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {renderEditableCell(v, "barcode", v.barcode, {
                        mono: true,
                        className: "text-xs",
                      })}
                    </TableCell>
                  )}
                  {hasWeight && (
                    <TableCell className="text-muted-foreground text-sm">
                      {v.weight !== null
                        ? v.weightUnit === "g"
                          ? formatWeightLb(v.weight)
                          : `${v.weight} ${v.weightUnit || ""}`
                        : "-"}
                    </TableCell>
                  )}
                  {hasPkgDimensions && (
                    <TableCell className="text-muted-foreground text-sm">
                      {v.packagingDimensions
                        ? convertPkgDimsStringToInches(v.packagingDimensions)
                        : "-"}
                    </TableCell>
                  )}
                  {hasImages && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end">
                        <FeaturedImagePicker
                          variantId={v.id}
                          featuredImageId={v.featuredImageId ?? null}
                          allImages={dedupedImages}
                          imageIdToRepresentative={imageIdToRepresentative}
                          productId={productId}
                          selectedVariantIds={selectedIds}
                          onUpdated={onVariantsChanged}
                        />
                      </div>
                    </TableCell>
                  )}
                  {productId && (
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        disabled={togglingHide === v.id}
                        onClick={() => toggleHidden(v.id, hidden)}
                        title={hidden ? "Unhide variant" : "Hide variant"}
                      >
                        {hidden ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
                    </TableCell>
                  )}
                </SortableTableRow>
              );
            })}
          </TableBody>
          </SortableContext>
        </Table>
        </DndContext>
      </div>

      {/* Bulk Edit Dialog */}
      <Dialog
        open={bulkEditField !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBulkEditField(null);
            setBulkEditValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Bulk Edit{" "}
              {BULK_EDIT_FIELDS.find((f) => f.key === bulkEditField)?.label}
            </DialogTitle>
            <DialogDescription>
              Apply to {selectedIds.size} selected variant
              {selectedIds.size !== 1 ? "s" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder={
                bulkEditField === "price"
                  ? "e.g. 29.99"
                  : bulkEditField === "compareAtPrice"
                    ? "e.g. 39.99 (leave empty to clear)"
                    : bulkEditField === "sku"
                      ? "e.g. PROD-001"
                      : "Enter value"
              }
              value={bulkEditValue}
              onChange={(e) => setBulkEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyBulkEdit();
              }}
              autoFocus
            />
            {bulkEditField === "compareAtPrice" && (
              <p className="text-muted-foreground text-xs">
                Leave empty to clear the compare-at price for all selected
                variants.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBulkEditField(null);
                setBulkEditValue("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={applyBulkEdit} disabled={bulkSaving}>
              {bulkSaving
                ? "Applying..."
                : `Apply to ${selectedIds.size} variant${
                    selectedIds.size !== 1 ? "s" : ""
                  }`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Variants</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} variant
              {selectedIds.size !== 1 ? "s" : ""}? This cannot be undone. Images
              assigned to these variants will be unlinked but not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteSelected}
              disabled={deleting}
            >
              {deleting
                ? "Deleting..."
                : `Delete ${selectedIds.size} variant${
                    selectedIds.size !== 1 ? "s" : ""
                  }`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeaturedImagePicker — single thumbnail + popover grid. One pick per variant.
// ─────────────────────────────────────────────────────────────────────────────
interface FeaturedImagePickerProps {
  variantId: string;
  featuredImageId: string | null;
  allImages: VariantImageItem[];
  imageIdToRepresentative: Map<string, VariantImageItem>;
  productId?: string;
  /**
   * Currently-checked variant IDs from the bulk-select column. When the
   * row's own variantId is in this set AND the set has more than one entry,
   * picking an image bulk-applies to every selected variant via one
   * transactional PATCH. Otherwise the pick targets only this variant.
   */
  selectedVariantIds?: Set<string>;
  onUpdated?: () => void;
}

function FeaturedImagePicker({
  variantId,
  featuredImageId,
  allImages,
  imageIdToRepresentative,
  productId,
  selectedVariantIds,
  onUpdated,
}: FeaturedImagePickerProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resolve the featured row via the id→representative map. This handles
  // sister-row IDs that got deduped out of `allImages`.
  const featuredRow = useMemo(() => {
    if (!featuredImageId) return null;
    return (
      imageIdToRepresentative.get(featuredImageId) ??
      allImages.find((img) => img.id === featuredImageId) ??
      null
    );
  }, [allImages, imageIdToRepresentative, featuredImageId]);

  // The currently-selected tile key (so we can highlight the matching tile
  // regardless of whether featuredImageId points at the rep or a sister).
  const selectedTileId = featuredRow?.id ?? null;

  const handlePick = useCallback(
    async (imageId: string | null) => {
      if (!productId) return;
      // Bulk mode fires when THIS variant is part of a multi-selection. A
      // single click on the picker then writes the same featuredImageId to
      // every checked variant atomically. If nothing is checked or only this
      // row is checked, fall through to the singular endpoint.
      const isBulk =
        !!selectedVariantIds &&
        selectedVariantIds.size > 1 &&
        selectedVariantIds.has(variantId);
      setBusy(true);
      try {
        let res: Response;
        if (isBulk) {
          const targetIds = Array.from(selectedVariantIds!);
          res = await fetch(`/api/products/${productId}/variants`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              updates: targetIds.map((id) => ({ id, featuredImageId: imageId })),
            }),
          });
        } else {
          res = await fetch(
            `/api/products/${productId}/variants/${variantId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ featuredImageId: imageId }),
            },
          );
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        if (isBulk) {
          toast.success(
            `Applied to ${selectedVariantIds!.size} selected variants`,
          );
        }
        onUpdated?.();
        setOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to set featured image",
        );
      } finally {
        setBusy(false);
      }
    },
    [productId, variantId, selectedVariantIds, onUpdated],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-8 w-8 rounded border bg-muted/30 transition hover:ring-2 hover:ring-ring/40",
            busy && "opacity-50",
          )}
          aria-label="Change featured image"
          disabled={!productId}
        >
          {featuredRow ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={featuredRow.sourceUrl}
              alt={featuredRow.altText || "featured variant image"}
              className="h-full w-full rounded object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              -
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Choose featured image (one per variant)
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => handlePick(null)}
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded border text-xs text-muted-foreground transition hover:ring-2 hover:ring-ring/40",
              featuredImageId === null && "ring-2 ring-primary",
            )}
            disabled={busy}
          >
            None
          </button>
          {allImages.map((img) => {
            const isPicked = img.id === selectedTileId;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => handlePick(img.id)}
                className={cn(
                  "relative h-16 w-16 overflow-hidden rounded border transition hover:ring-2 hover:ring-ring/40",
                  isPicked && "ring-2 ring-primary",
                )}
                disabled={busy}
                title={img.altText || ""}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.sourceUrl}
                  alt={img.altText || "product image"}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {isPicked && (
                  <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag-and-drop scaffolding — variant rows use @dnd-kit/sortable to reorder.
// The drag listeners live in a context so the row's <SortableTableRow> can own
// the node ref + transform while a small <DragHandle> in the # column attaches
// the pointer/keyboard listeners. Click handlers on other cells stay unaffected.
// ─────────────────────────────────────────────────────────────────────────────
const DragListenersContext = createContext<DraggableSyntheticListeners>(undefined);

interface SortableTableRowProps {
  id: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLTableRowElement>;
  children: ReactNode;
}

const SortableTableRow = forwardRef<HTMLTableRowElement, SortableTableRowProps>(
  function SortableTableRow({ id, className, onClick, children }, _ref) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id });
    const style: CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : undefined,
      zIndex: isDragging ? 10 : undefined,
      position: isDragging ? "relative" : undefined,
    };
    return (
      <DragListenersContext.Provider value={listeners}>
        <TableRow
          ref={setNodeRef}
          style={style}
          className={cn(isDragging && "shadow-md", className)}
          onClick={onClick}
          {...attributes}
        >
          {children}
        </TableRow>
      </DragListenersContext.Provider>
    );
  },
);

function DragHandle({ disabled }: { disabled?: boolean }) {
  const listeners = useContext(DragListenersContext);
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "text-muted-foreground hover:text-foreground p-0.5 leading-none disabled:opacity-20",
        disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
      )}
      aria-label="Drag to reorder"
      title="Drag to reorder"
      {...(disabled ? {} : listeners)}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AxisSortHead — clickable column header for an option axis. Shows the axis
// name + a sort-direction icon (up / down / neutral) and triggers
// `cycleAxisSort(axisIndex)` on click.
// ─────────────────────────────────────────────────────────────────────────────
interface AxisSortHeadProps {
  axisIndex: 0 | 1 | 2;
  name: string;
  axisSort: { axisIndex: 0 | 1 | 2; direction: "asc" | "desc" } | null;
  onCycle: (axisIndex: 0 | 1 | 2) => void;
}

function AxisSortHead({ axisIndex, name, axisSort, onCycle }: AxisSortHeadProps) {
  const active = axisSort?.axisIndex === axisIndex;
  const Icon = active
    ? axisSort!.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <TableHead
      className="hover:text-foreground cursor-pointer select-none"
      onClick={() => onCycle(axisIndex)}
      title={`Sort by ${name}`}
    >
      <span className="inline-flex items-center gap-1">
        {name} <Icon className="h-3 w-3" />
      </span>
    </TableHead>
  );
}

