"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChevronDown, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const RULE_CATEGORIES = ["description", "title", "seo", "tags", "image"] as const;
type RuleCategory = (typeof RULE_CATEGORIES)[number];

interface JobRow {
  id: string;
  sourceUrl: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  options?: string | null;
  product?: { id: string; title?: string | null } | null;
}

type SortDir = "asc" | "desc";

const STATUS_VARIANT: Record<
  string,
  { label: string; className: string }
> = {
  queued: {
    label: "queued",
    className: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  },
  running: {
    label: "running",
    className:
      "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  },
  processing: {
    label: "processing",
    className:
      "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  },
  ready: {
    label: "ready",
    className:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  },
  complete: {
    label: "complete",
    className:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  },
  failed: {
    label: "failed",
    className: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
  },
  error: {
    label: "error",
    className: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
  },
};

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANT[status] ?? {
    label: status,
    className: "bg-zinc-100 text-zinc-800",
  };
  return (
    <Badge variant="outline" className={cn("font-normal", v.className)}>
      {v.label}
    </Badge>
  );
}

function inferMethod(options: string | null | undefined): string {
  if (!options) return "-";
  try {
    const parsed = JSON.parse(options) as Record<string, unknown>;
    const ruleToggles = parsed.ruleToggles as
      | Record<string, boolean>
      | undefined;
    const enabled =
      ruleToggles &&
      Object.values(ruleToggles).filter((v) => v === true).length;
    return enabled !== undefined ? `${enabled} rules` : "—";
  } catch {
    return "—";
  }
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

interface JobListProps {
  /** How often to poll, in ms */
  pollMs?: number;
}

export function JobList({ pollMs = 3000 }: JobListProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Anchor + action for shift+click range selection. Plain click sets both;
  // shift+click extends the same action (check / uncheck) to the inclusive
  // range, matching the gallery's behavior.
  const [lastCheckedIdx, setLastCheckedIdx] = useState<number | null>(null);
  const [lastCheckedAction, setLastCheckedAction] = useState<"check" | "uncheck" | null>(null);
  // Shopify connections — fetched once for the bulk Upload button (0 disables,
  // 1 single-click, 2+ opens a Popover to pick which store).
  const [connections, setConnections] = useState<
    Array<{ id: string; label: string; isDefault: boolean }>
  >([]);
  const [reapplySelection, setReapplySelection] = useState<Record<RuleCategory, boolean>>({
    description: false,
    title: false,
    seo: false,
    tags: false,
    image: false,
  });

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: JobRow[] = Array.isArray(json?.jobs) ? json.jobs : [];
      setJobs(list);
    } catch {
      // Silent fail — keep last good state
    } finally {
      setLoading(false);
    }
  }, []);

  const kickProcessor = useCallback(async () => {
    try {
      await fetch("/api/jobs/process", { method: "POST" });
    } catch {
      // fire-and-forget
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    kickProcessor();
    const id = setInterval(() => {
      fetchJobs();
      kickProcessor();
    }, pollMs);
    return () => clearInterval(id);
  }, [fetchJobs, kickProcessor, pollMs]);

  // One-shot fetch of Shopify connections for the bulk Upload button.
  useEffect(() => {
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((json) => {
        if (Array.isArray(json?.connections)) setConnections(json.connections);
      })
      .catch(() => {
        // silent — bulk Upload button just stays disabled
      });
  }, []);

  const sorted = [...jobs].sort((a, b) => {
    const ad = new Date(a.createdAt).getTime();
    const bd = new Date(b.createdAt).getTime();
    return sortDir === "desc" ? bd - ad : ad - bd;
  });

  function handleRowClick(job: JobRow) {
    if (job.status === "ready" && job.product?.id) {
      router.push(`/review/${job.product.id}`);
    }
  }

  // Prefetch the review page on hover so the click feels instant. Cheap —
  // Next caches the result and dedupes repeat calls for the same href.
  function handleRowHover(job: JobRow) {
    if (job.status === "ready" && job.product?.id) {
      router.prefetch(`/review/${job.product.id}`);
    }
  }

  // Bulk action plumbing ─────────────────────────────────────────────────────
  const eligibleJobIds = useMemo(
    () =>
      sorted
        .filter((j) => j.status === "ready" && j.product?.id)
        .map((j) => j.id),
    [sorted],
  );
  const allEligibleSelected =
    eligibleJobIds.length > 0 &&
    eligibleJobIds.every((id) => selectedJobIds.has(id));

  function toggleSelectAllEligible(checked: boolean) {
    if (checked) {
      setSelectedJobIds(new Set(eligibleJobIds));
    } else {
      setSelectedJobIds(new Set());
    }
  }

  function toggleSelected(jobId: string, checked: boolean) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedJobIds(new Set());
    setLastCheckedIdx(null);
    setLastCheckedAction(null);
  }

  /**
   * Click handler for a row's checkbox wrapper. The inner Radix Checkbox
   * handles the per-row toggle via its own onCheckedChange — this wrapper
   * only owns the shift+click range-extend path. On a plain click we just
   * remember the anchor (the row we clicked) and the action that the
   * Checkbox is about to apply (check or uncheck), so a subsequent
   * shift+click knows which direction to fill.
   */
  function handleRowCheckClick(e: React.MouseEvent, idx: number, jobId: string) {
    if (e.shiftKey && lastCheckedIdx !== null && lastCheckedAction !== null) {
      const [lo, hi] =
        lastCheckedIdx < idx ? [lastCheckedIdx, idx] : [idx, lastCheckedIdx];
      setSelectedJobIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const j = sorted[i];
          // Only eligible jobs (ready + product attached) can be in the
          // selection pool — skip the rest silently.
          if (!j || j.status !== "ready" || !j.product?.id) continue;
          if (lastCheckedAction === "check") next.add(j.id);
          else next.delete(j.id);
        }
        return next;
      });
      // Don't move the anchor — let the user chain further shift-clicks.
      return;
    }
    // Plain click — Checkbox toggles via onCheckedChange. Record the anchor
    // and the action it's about to apply (pre-click state inverted).
    const willBeSelected = !selectedJobIds.has(jobId);
    setLastCheckedIdx(idx);
    setLastCheckedAction(willBeSelected ? "check" : "uncheck");
  }

  function selectedProductIds(): string[] {
    return sorted
      .filter((j) => selectedJobIds.has(j.id) && j.product?.id)
      .map((j) => j.product!.id);
  }

  // Both bulk actions POST once to a server-side endpoint that loops sequentially
  // and returns 202 immediately. The work continues in the Node process even
  // after the user navigates away — no client-side per-product loop, no
  // visible-only progress that dies on unmount.
  async function runBulkRewrite() {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/products/bulk/rewrite-descriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const count = typeof json.count === "number" ? json.count : productIds.length;
      toast.success(
        `Rewriting ${count} description${count === 1 ? "" : "s"} in the background — refresh to see them as they complete.`,
      );
      setSelectedJobIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk rewrite failed");
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  async function runBulkApplyPreset() {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/products/bulk/apply-gallery-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const count = typeof json.count === "number" ? json.count : productIds.length;
      toast.success(
        `Applying preset order on ${count} product${count === 1 ? "" : "s"} in the background — refresh to see them as they complete.`,
      );
      setSelectedJobIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk apply-preset failed");
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  async function runBulkSetLifestyleUnitMode(
    mode: "auto" | "single" | "multi",
  ) {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/products/bulk/set-lifestyle-unit-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const updated = typeof json.updated === "number" ? json.updated : productIds.length;
      toast.success(`Lifestyle units → ${mode} on ${updated} product(s)`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Bulk lifestyle-units update failed",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function runBulkDeleteOriginals() {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    if (
      !window.confirm(
        `Delete originally-scraped 1688 images for ${productIds.length} product${productIds.length === 1 ? "" : "s"}? Starred images and AI-generated images (heroes/lifestyles) will be kept. This runs in the background.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/products/bulk/delete-originals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const count = typeof json.count === "number" ? json.count : productIds.length;
      toast.success(
        `Deleting originals for ${count} product${count === 1 ? "" : "s"} in the background.`,
      );
      setSelectedJobIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete originals failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function runBulkAudit() {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/products/bulk/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const count = typeof json.count === "number" ? json.count : productIds.length;
      toast.success(
        `Auditing ${count} product${count === 1 ? "" : "s"} in the background — refresh each to see fixes land.`,
      );
      setSelectedJobIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk audit failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function runBulkReapply(categories?: readonly RuleCategory[]) {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    setBulkBusy(true);
    try {
      const body: { productIds: string[]; categories?: readonly RuleCategory[] } = {
        productIds,
      };
      if (categories && categories.length > 0) body.categories = categories;
      const res = await fetch(`/api/products/bulk/reapply-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const okN = typeof json.ok === "number" ? json.ok : 0;
      const failedN = typeof json.failed === "number" ? json.failed : 0;
      const total = typeof json.count === "number" ? json.count : productIds.length;
      const label = categories?.length ? categories.join(", ") : "all rules";
      if (failedN === 0) {
        toast.success(`Re-applied ${label} on ${okN}/${total} product(s).`);
      } else if (okN === 0) {
        toast.error(`Re-apply ${label} failed for all ${total} product(s) — see server logs.`);
      } else {
        toast.warning(
          `Re-applied ${label} on ${okN}/${total}. ${failedN} failed — see server logs.`,
        );
      }
      setSelectedJobIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk re-apply failed");
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
    // Reset the picker after dispatch so the next round starts clean.
    setReapplySelection({
      description: false,
      title: false,
      seo: false,
      tags: false,
      image: false,
    });
  }

  // Fire the bulk upload-to-Shopify endpoint. Server returns 202 immediately
  // and runs the per-product upload loop as a detached promise — user can
  // navigate freely. Optional `connectionId` overrides the server-side
  // default-or-only-one resolution.
  async function runBulkUpload(connectionId?: string) {
    const productIds = selectedProductIds();
    if (productIds.length === 0) return;
    setBulkBusy(true);
    try {
      const body: { productIds: string[]; connectionId?: string } = { productIds };
      if (connectionId) body.connectionId = connectionId;
      const res = await fetch(`/api/products/bulk/upload-to-shopify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const okN = typeof json.ok === "number" ? json.ok : 0;
      const failedN = typeof json.failed === "number" ? json.failed : 0;
      const total = typeof json.count === "number" ? json.count : productIds.length;
      const label = typeof json.connectionLabel === "string" ? json.connectionLabel : "Shopify";
      if (failedN === 0) {
        toast.success(`Uploaded ${okN}/${total} to ${label}.`);
      } else if (okN === 0) {
        toast.error(`All ${total} uploads to ${label} failed — see server logs.`);
      } else {
        toast.warning(
          `Uploaded ${okN}/${total} to ${label}. ${failedN} failed — see server logs.`,
        );
      }
      setSelectedJobIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setBulkBusy(false);
    }
  }

  // Delete selected jobs + their scraped products. Single transactional
  // DELETE call; cascades wipe variants, images, and JobLogs.
  async function runBulkDelete() {
    const jobIds = Array.from(selectedJobIds);
    if (jobIds.length === 0) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const dj = typeof json.deletedJobs === "number" ? json.deletedJobs : jobIds.length;
      const dp = typeof json.deletedProducts === "number" ? json.deletedProducts : 0;
      toast.success(
        `Deleted ${dj} job${dj === 1 ? "" : "s"}` +
          (dp > 0 ? ` and ${dp} product${dp === 1 ? "" : "s"}.` : "."),
      );
      setSelectedJobIds(new Set());
      setShowDeleteDialog(false);
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const pickedCategories = (Object.keys(reapplySelection) as RuleCategory[]).filter(
    (k) => reapplySelection[k],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Jobs</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchJobs();
              kickProcessor();
            }}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {selectedJobIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 p-2">
            <span className="text-sm font-medium">
              {selectedJobIds.size} selected
              {bulkProgress ? ` · ${bulkProgress}` : ""}
            </span>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={runBulkRewrite}
              disabled={bulkBusy}
            >
              Rewrite description
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={runBulkApplyPreset}
              disabled={bulkBusy}
            >
              Apply preset order
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={bulkBusy}
              onClick={runBulkAudit}
              title="Run the post-scrape audit on selected products (waffle SKU rename, link unlinked variants, hide pack-axis remnants, drop empty axes, unify size images + cm→in, retry image-only descriptions)."
            >
              Audit selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={bulkBusy}
              onClick={runBulkDeleteOriginals}
              title="Delete originally-scraped 1688 gallery images on selected products (keeps heroes, lifestyles, and any starred images)."
            >
              Delete originals
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  title="Set the Lifestyle units mode (Auto / Single / Multi) on the selected products. Drives the multi-unit majority rule in the lifestyle image generator."
                >
                  Lifestyle units <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {(
                  [
                    { mode: "auto", label: "Auto", help: "Use category default" },
                    { mode: "single", label: "Single-unit", help: "Force all 6 single" },
                    { mode: "multi", label: "Multi-unit", help: "Force 4–5 of 6 multi" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    className="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50"
                    onClick={() => runBulkSetLifestyleUnitMode(opt.mode)}
                    disabled={bulkBusy}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.help}</div>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  title="Re-apply rules — pick All, or check a subset"
                >
                  Re-apply rules <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <button
                  type="button"
                  className="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-50"
                  onClick={() => runBulkReapply()}
                  disabled={bulkBusy}
                >
                  All categories
                </button>
                <div className="my-1 h-px bg-border" />
                <div className="space-y-1 px-1 py-1">
                  {RULE_CATEGORIES.map((cat) => (
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
                        disabled={bulkBusy}
                      />
                      <span className="capitalize">{cat}</span>
                    </label>
                  ))}
                </div>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  className="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-50"
                  onClick={() => {
                    if (pickedCategories.length === 0) return;
                    void runBulkReapply(pickedCategories);
                  }}
                  disabled={bulkBusy || pickedCategories.length === 0}
                >
                  Re-apply selected ({pickedCategories.length})
                </button>
              </PopoverContent>
            </Popover>
            {connections.length === 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                title="Add a Shopify connection in Settings first"
              >
                <Upload className="mr-1 h-3 w-3" />
                Upload to Shopify
              </Button>
            ) : connections.length === 1 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => runBulkUpload(connections[0].id)}
                disabled={bulkBusy}
                title={`Upload selected to ${connections[0].label}`}
              >
                <Upload className="mr-1 h-3 w-3" />
                Upload to Shopify
              </Button>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    title="Upload selected — pick which Shopify store"
                  >
                    <Upload className="mr-1 h-3 w-3" />
                    Upload to Shopify <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1" align="start">
                  {connections.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50"
                      onClick={() => runBulkUpload(c.id)}
                      disabled={bulkBusy}
                    >
                      {c.label}
                      {c.isDefault && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (default)
                        </span>
                      )}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
              disabled={bulkBusy || deleting}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={bulkBusy}
            >
              Clear
            </Button>
          </div>
        )}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allEligibleSelected}
                    onCheckedChange={(v) => toggleSelectAllEligible(v === true)}
                    aria-label="Select all ready jobs"
                    disabled={eligibleJobIds.length === 0 || bulkBusy}
                  />
                </TableHead>
                <TableHead>Source URL</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() =>
                    setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                  }
                >
                  Created {sortDir === "desc" ? "↓" : "↑"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground"
                  >
                    {loading ? "Loading…" : "No jobs yet."}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((job, i) => {
                  const clickable =
                    job.status === "ready" && job.product?.id;
                  const eligible = clickable;
                  const isSelected = selectedJobIds.has(job.id);
                  return (
                    <TableRow
                      key={job.id}
                      className={cn(clickable && "cursor-pointer")}
                      onClick={() => handleRowClick(job)}
                      onMouseEnter={() => handleRowHover(job)}
                    >
                      <TableCell
                        className="w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {eligible ? (
                          <div
                            role="presentation"
                            onClick={(e) => handleRowCheckClick(e, i, job.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(v) =>
                                toggleSelected(job.id, v === true)
                              }
                              disabled={bulkBusy}
                              aria-label="Select job for bulk action"
                            />
                          </div>
                        ) : (
                          <Checkbox checked={false} disabled aria-hidden />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <span title={job.sourceUrl}>
                          {truncate(job.sourceUrl, 70)}
                        </span>
                        {job.errorMessage && (
                          <div className="mt-1 text-xs text-destructive">
                            {truncate(job.errorMessage, 80)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {job.product?.title ? (
                          <div
                            className="max-w-[24rem] truncate"
                            title={job.product.title}
                          >
                            {job.product.title}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inferMethod(job.options ?? null)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(job.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Delete {selectedJobIds.size} job
                {selectedJobIds.size === 1 ? "" : "s"} and their products?
              </DialogTitle>
              <DialogDescription>
                This permanently removes each product&apos;s variants, images,
                and any generated hero / lifestyle data, plus the job&apos;s
                logs. Cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={runBulkDelete}
                disabled={deleting || selectedJobIds.size === 0}
              >
                {deleting
                  ? "Deleting..."
                  : `Delete ${selectedJobIds.size}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
