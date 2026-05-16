"use client";

import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";

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
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
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
                    colSpan={5}
                    className="text-center text-sm text-muted-foreground"
                  >
                    {loading ? "Loading…" : "No jobs yet."}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((job) => {
                  const clickable =
                    job.status === "ready" && job.product?.id;
                  return (
                    <TableRow
                      key={job.id}
                      className={cn(clickable && "cursor-pointer")}
                      onClick={() => handleRowClick(job)}
                    >
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
