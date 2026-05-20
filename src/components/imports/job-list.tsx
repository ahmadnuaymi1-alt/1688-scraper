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
import { ChevronDown } from "lucide-react";
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
  }

  function selectedProductIds(): string[] {
    return sorted
      .filter((j) => selectedJobIds.has(j.id) && j.product?.id)
      .map((j) => j.product!.id);
  }

  async function runBulk(opts: {
    label: string;
    callPerProduct: (productId: string) => Promise<void>;
  }) {
    setBulkBusy(true);
    const productIds = selectedProductIds();
    let ok = 0;
    const failures: Array<{ productId: string; error: string }> = [];
    for (let i = 0; i < productIds.length; i++) {
      setBulkProgress(`${i + 1}/${productIds.length}…`);
      try {
        await opts.callPerProduct(productIds[i]);
        ok++;
      } catch (err) {
        failures.push({
          productId: productIds[i],
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }
    setBulkBusy(false);
    setBulkProgress(null);
    if (ok > 0) {
      toast.success(
        `${opts.label}: ${ok} succeeded${failures.length ? `, ${failures.length} failed` : ""}`,
      );
    }
    if (failures.length > 0) {
      console.warn(`Bulk ${opts.label} failures:`, failures);
      toast.error(`${failures.length} failed — see console`);
    }
    fetchJobs();
  }

  async function runBulkRewrite() {
    await runBulk({
      label: "Rewrite description",
      callPerProduct: async (id) => {
        const res = await fetch(`/api/products/${id}/rewrite-description`, {
          method: "POST",
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
      },
    });
  }

  async function runBulkReapply(categories?: readonly RuleCategory[]) {
    await runBulk({
      label: categories?.length
        ? `Re-apply ${categories.join(", ")}`
        : "Re-apply all rules",
      callPerProduct: async (id) => {
        const body =
          categories && categories.length > 0
            ? JSON.stringify({ categories })
            : undefined;
        const res = await fetch(`/api/products/${id}/reapply-rules`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
      },
    });
    // Reset the picker after a run completes so the next round starts clean.
    setReapplySelection({
      description: false,
      title: false,
      seo: false,
      tags: false,
      image: false,
    });
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
                sorted.map((job) => {
                  const clickable =
                    job.status === "ready" && job.product?.id;
                  const eligible = clickable;
                  const isSelected = selectedJobIds.has(job.id);
                  return (
                    <TableRow
                      key={job.id}
                      className={cn(clickable && "cursor-pointer")}
                      onClick={() => handleRowClick(job)}
                    >
                      <TableCell
                        className="w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {eligible ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(v) =>
                              toggleSelected(job.id, v === true)
                            }
                            disabled={bulkBusy}
                            aria-label="Select job for bulk action"
                          />
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
      </CardContent>
    </Card>
  );
}
