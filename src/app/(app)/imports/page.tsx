"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { UrlInput, validateUrls } from "@/components/imports/url-input";
import { ScrapeOptionsPanel } from "@/components/imports/scrape-options-panel";
import { JobList } from "@/components/imports/job-list";
import {
  DEFAULT_SCRAPE_OPTIONS,
  ScrapeOptionsSchema,
  type ScrapeOptions,
} from "@/types/scrape-options";

interface PresetSummary {
  id: string;
  name: string;
  options: string;
  isDefault: boolean;
}

export default function ImportsPage() {
  const [urlsRaw, setUrlsRaw] = useState("");
  const [options, setOptions] = useState<ScrapeOptions>(
    () => DEFAULT_SCRAPE_OPTIONS,
  );
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scrape-presets");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const list: PresetSummary[] = Array.isArray(json?.presets)
          ? json.presets
          : [];
        const def = list.find((p) => p.isDefault);
        if (def) {
          try {
            const raw = JSON.parse(def.options);
            const parsed = ScrapeOptionsSchema.safeParse(raw);
            if (parsed.success) {
              setOptions(parsed.data);
            }
          } catch {
            // keep DEFAULT_SCRAPE_OPTIONS
          }
        }
      } catch {
        // keep DEFAULT_SCRAPE_OPTIONS
      } finally {
        if (!cancelled) setPresetsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validation = validateUrls(urlsRaw);
  const canSubmit =
    validation.urls.length > 0 && !validation.hasInvalid && !submitting;

  async function handleRunScrape() {
    if (validation.urls.length === 0) {
      toast.error("Add at least one valid URL");
      return;
    }
    if (validation.hasInvalid) {
      toast.error(
        `${validation.invalidCount} invalid URL${
          validation.invalidCount === 1 ? "" : "s"
        }. Fix or remove them first.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: validation.urls, options }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(
        `Scrape queued (${validation.urls.length} URL${
          validation.urls.length === 1 ? "" : "s"
        })`,
      );
      setUrlsRaw("");
      // Trigger processing immediately
      fetch("/api/jobs/process", { method: "POST" }).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
        <p className="text-sm text-muted-foreground">
          Paste 1688 product URLs and queue them for scraping.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New scrape</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UrlInput
            value={urlsRaw}
            onChange={setUrlsRaw}
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Button onClick={handleRunScrape} disabled={!canSubmit}>
              {submitting
                ? "Queuing..."
                : `Run scrape${
                    validation.urls.length > 0
                      ? ` (${validation.urls.length})`
                      : ""
                  }`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {presetsLoaded ? (
        <ScrapeOptionsPanel value={options} onChange={setOptions} />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Loading presets…
          </CardContent>
        </Card>
      )}

      <JobList pollMs={3000} />
    </div>
  );
}
