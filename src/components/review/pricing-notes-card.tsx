"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  AiPricingRationale,
  PricingTier,
} from "@/types/pricing-rationale";

interface PricingNotesCardProps {
  productId: string;
  productTitle: string;
  pricingNotes: AiPricingRationale | null;
  onUpdated: (next: AiPricingRationale) => void;
  /** Unused — retained for caller compatibility. */
  onUseName?: (suggestion: string) => void;
}

const LADDER_KEYS: Array<{
  key: PricingTier["label"];
  label: string;
  isApplyable: boolean;
}> = [
  { key: "launch", label: "Launch", isApplyable: true },
  { key: "stretch", label: "Stretch", isApplyable: true },
  { key: "bundle", label: "Bundle", isApplyable: true },
  { key: "compareAt", label: "Compare-at", isApplyable: false },
];

function formatTierPrice(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `$${amount.toFixed(2).replace(/\.00$/, "")}`;
}

export function PricingNotesCard({
  productId,
  pricingNotes,
  onUpdated,
}: PricingNotesCardProps) {
  const router = useRouter();
  const [recalculating, setRecalculating] = useState(false);
  const [tierUpdating, setTierUpdating] = useState<PricingTier["label"] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  if (!pricingNotes) return null;

  const { ladder, recommended, comps, marketSaturated, notes, perVariantPricing } = pricingNotes;

  // Index the ladder by label for quick lookup.
  const ladderByLabel = new Map<PricingTier["label"], PricingTier>();
  for (const tier of ladder) {
    ladderByLabel.set(tier.label, tier);
  }
  const appliedLabel = recommended?.label ?? null;

  async function handleApplyTier(tier: PricingTier["label"]) {
    if (tier === appliedLabel) return;
    setTierUpdating(tier);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/recalculate-pricing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierOverride: tier }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (json.pricingNotes) {
        onUpdated(json.pricingNotes as AiPricingRationale);
      }
      // Server applied the new tier to every variant — refresh the page so
      // the variant table re-reads the updated prices.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tier change failed");
    } finally {
      setTierUpdating(null);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/recalculate-pricing`,
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
        onUpdated(json.pricingNotes as AiPricingRationale);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recalculate failed");
    } finally {
      setRecalculating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          AI Pricing
          <Badge
            className={cn(
              "font-normal",
              marketSaturated
                ? "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200"
                : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
            )}
          >
            {marketSaturated ? "saturated" : "open"}
          </Badge>
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecalculate}
          disabled={recalculating || tierUpdating !== null}
        >
          {recalculating ? "Recalculating…" : "Recalculate"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {/* Pricing ladder */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LADDER_KEYS.map((t) => {
            const tier = ladderByLabel.get(t.key);
            const value = tier?.price;
            const isApplied = t.isApplyable && t.key === appliedLabel;
            const isUpdating = tierUpdating === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() =>
                  t.isApplyable ? handleApplyTier(t.key) : undefined
                }
                disabled={
                  !t.isApplyable ||
                  isUpdating ||
                  tierUpdating !== null ||
                  !tier
                }
                className={cn(
                  "rounded-md border px-3 py-2 text-left transition-colors",
                  isApplied
                    ? "border-primary bg-primary/5 ring-primary ring-1"
                    : t.isApplyable && tier
                      ? "border-border hover:bg-accent cursor-pointer"
                      : "border-border bg-muted/40 cursor-default",
                  (tierUpdating !== null || recalculating) && "opacity-60",
                )}
                title={tier?.reasoning ?? undefined}
              >
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {t.label}
                  {isApplied && <span className="text-primary ml-1">✓</span>}
                </div>
                <div className="font-mono text-base font-semibold">
                  {value !== undefined ? formatTierPrice(value) : "—"}
                </div>
                {isUpdating && (
                  <div className="text-muted-foreground text-xs">Updating…</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Notes */}
        {notes && notes.trim() && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {notes}
          </p>
        )}

        {/* Per-variant pricing summary — only shown when the AI returned the
            optional block (added after the per-variant-pricing feature). */}
        {perVariantPricing && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="font-semibold uppercase tracking-wide text-muted-foreground">
              Per-variant pricing
            </div>
            <div className="mt-1 text-foreground">
              <span className="capitalize">{perVariantPricing.mode}</span>
              {perVariantPricing.rationale ? ` — ${perVariantPricing.rationale}` : ""}
            </div>
            {perVariantPricing.mode === "tiered" && perVariantPricing.tiers && (
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {perVariantPricing.tiers.map((t) => (
                  <li key={t.label}>
                    <span className="font-medium text-foreground">{t.label}</span>{" "}
                    × <span className="font-mono">{t.multiplier.toFixed(2)}</span>
                    {" — "}
                    {t.variantPositions.length} variant
                    {t.variantPositions.length === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Comps */}
        {comps && comps.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Comparable products
            </div>
            <ul className="space-y-1 text-sm">
              {comps.map((c, idx) => (
                <li
                  key={`${c.title}-${idx}`}
                  className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1 last:border-b-0"
                >
                  <span className="truncate">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-4 hover:underline"
                      >
                        {c.title}
                      </a>
                    ) : (
                      c.title
                    )}
                    {c.source && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.source}
                      </span>
                    )}
                  </span>
                  <span className="font-mono whitespace-nowrap text-xs text-muted-foreground">
                    {c.currency} {c.price.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
