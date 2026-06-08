"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  DEFAULT_SCRAPE_OPTIONS,
  ScrapeOptionsSchema,
  type ScrapeOptions,
  type RuleToggles,
} from "@/types/scrape-options";
import { cn } from "@/lib/utils";

interface ShopifyConnectionSummary {
  id: string;
  label: string;
}

interface PresetSummary {
  id: string;
  name: string;
  options: string;
  isDefault: boolean;
}

const PRESET_NONE = "__none__";

interface ScrapeOptionsPanelProps {
  value: ScrapeOptions;
  onChange: (next: ScrapeOptions) => void;
  defaultOpen?: boolean;
}

const RULE_KEYS: Array<{ key: keyof RuleToggles; label: string }> = [
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "tags", label: "Tags" },
  { key: "image", label: "Image" },
  { key: "seo", label: "SEO" },
];

export function ScrapeOptionsPanel({
  value,
  onChange,
  defaultOpen = false,
}: ScrapeOptionsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [connections, setConnections] = useState<ShopifyConnectionSummary[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESET_NONE);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/scrape-presets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: PresetSummary[] = Array.isArray(json?.presets)
        ? json.presets.map((p: PresetSummary) => ({
            id: p.id,
            name: p.name,
            options: p.options,
            isDefault: p.isDefault,
          }))
        : [];
      setPresets(list);
    } catch {
      setPresets([]);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const selectedPreset =
    selectedPresetId === PRESET_NONE
      ? null
      : presets.find((p) => p.id === selectedPresetId) ?? null;

  function handlePresetSelect(id: string) {
    setSelectedPresetId(id);
    setShowSaveForm(false);
    if (id === PRESET_NONE) {
      onChange(DEFAULT_SCRAPE_OPTIONS);
      return;
    }
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    try {
      const raw = JSON.parse(preset.options);
      const parsed = ScrapeOptionsSchema.safeParse(raw);
      if (parsed.success) {
        onChange(parsed.data);
      } else {
        toast.warning(`Preset "${preset.name}" had invalid fields; using defaults`);
        onChange(DEFAULT_SCRAPE_OPTIONS);
      }
    } catch {
      toast.warning(`Preset "${preset.name}" was unreadable; using defaults`);
      onChange(DEFAULT_SCRAPE_OPTIONS);
    }
  }

  async function handleSaveNewPreset() {
    const name = newPresetName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    setPresetBusy(true);
    try {
      const res = await fetch("/api/scrape-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, options: value }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      toast.success(`Saved preset "${name}"`);
      setNewPresetName("");
      setShowSaveForm(false);
      await fetchPresets();
      if (json?.preset?.id) {
        setSelectedPresetId(json.preset.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleSaveChanges() {
    if (!selectedPreset) return;
    setPresetBusy(true);
    try {
      const res = await fetch(`/api/scrape-presets/${selectedPreset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: value }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(`Updated "${selectedPreset.name}"`);
      await fetchPresets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleSetDefault() {
    if (!selectedPreset) return;
    setPresetBusy(true);
    try {
      const res = await fetch(`/api/scrape-presets/${selectedPreset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(`"${selectedPreset.name}" set as default`);
      await fetchPresets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleDeletePreset() {
    if (!selectedPreset) return;
    if (!confirm(`Delete preset "${selectedPreset.name}"?`)) return;
    setPresetBusy(true);
    try {
      const res = await fetch(`/api/scrape-presets/${selectedPreset.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Deleted "${selectedPreset.name}"`);
      setSelectedPresetId(PRESET_NONE);
      onChange(DEFAULT_SCRAPE_OPTIONS);
      await fetchPresets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPresetBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/connections");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const list: ShopifyConnectionSummary[] = Array.isArray(json?.connections)
          ? json.connections.map((c: { id: string; label: string }) => ({
              id: c.id,
              label: c.label,
            }))
          : [];
        setConnections(list);
      } catch {
        if (!cancelled) setConnections([]);
      } finally {
        if (!cancelled) setConnectionsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(next: Partial<ScrapeOptions>) {
    onChange({ ...value, ...next });
  }

  function patchToggles(next: Partial<RuleToggles>) {
    patch({ ruleToggles: { ...value.ruleToggles, ...next } });
  }

  const inv = value.defaultInventory;

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Scrape Options</span>
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("space-y-6", !open && "hidden")}>
        {/* Preset bar */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Presets</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Select
                value={selectedPresetId}
                onValueChange={handlePresetSelect}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a preset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRESET_NONE}>— None —</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setShowSaveForm((s) => !s)}
              disabled={presetBusy}
            >
              Save as new…
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={handleSaveChanges}
              disabled={!selectedPreset || presetBusy}
            >
              Save changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={handleSetDefault}
              disabled={
                !selectedPreset || presetBusy || selectedPreset.isDefault
              }
            >
              {selectedPreset?.isDefault ? "Is default" : "Set as default"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={handleDeletePreset}
              disabled={!selectedPreset || presetBusy}
            >
              Delete
            </Button>
          </div>
          {showSaveForm && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Preset name"
                className="max-w-xs"
                disabled={presetBusy}
              />
              <Button
                size="sm"
                type="button"
                onClick={handleSaveNewPreset}
                disabled={presetBusy || !newPresetName.trim()}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  setShowSaveForm(false);
                  setNewPresetName("");
                }}
                disabled={presetBusy}
              >
                Cancel
              </Button>
            </div>
          )}
        </section>

        <Separator />

        {/* Rule toggles */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Transformation rules</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {RULE_KEYS.map((rk) => (
              <Label key={rk.key} className="cursor-pointer">
                <Checkbox
                  checked={value.ruleToggles[rk.key]}
                  onCheckedChange={(c) =>
                    patchToggles({ [rk.key]: c === true } as Partial<RuleToggles>)
                  }
                />
                <span>{rk.label}</span>
              </Label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Label className="cursor-pointer">
              <Checkbox
                checked={value.autoCurateVariants}
                onCheckedChange={(c) =>
                  patch({ autoCurateVariants: c === true })
                }
              />
              <span>Auto-curate variants</span>
            </Label>
            <Label className="cursor-pointer">
              <Checkbox
                checked={value.suggestedPricing}
                onCheckedChange={(c) =>
                  patch({ suggestedPricing: c === true })
                }
              />
              <span>Suggested pricing (AI)</span>
            </Label>
          </div>
        </section>

        <Separator />

        {/* Product metadata */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Input
              id="vendor"
              value={value.vendor ?? ""}
              onChange={(e) => patch({ vendor: e.target.value || undefined })}
              placeholder="Your brand"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="productType">Product Type</Label>
            <Input
              id="productType"
              value={value.productType ?? ""}
              onChange={(e) =>
                patch({ productType: e.target.value || undefined })
              }
              placeholder="__auto__"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="extraTags">Extra Tags</Label>
            <Input
              id="extraTags"
              value={value.extraTags ?? ""}
              onChange={(e) => patch({ extraTags: e.target.value || undefined })}
              placeholder="tag1, tag2, tag3"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="languageVariant">Language Variant</Label>
            <Select
              value={value.languageVariant}
              onValueChange={(v) => patch({ languageVariant: v })}
            >
              <SelectTrigger id="languageVariant" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="en-GB">English (UK)</SelectItem>
                <SelectItem value="en-AU">English (AU)</SelectItem>
                <SelectItem value="en-CA">English (CA)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="productStatus">Product Status</Label>
            <Select
              value={value.productStatus}
              onValueChange={(v) =>
                patch({ productStatus: v as "draft" | "active" })
              }
            >
              <SelectTrigger id="productStatus" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <Separator />

        {/* Pricing */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sourceCurrency">Source Currency</Label>
            <Select
              value={value.sourceCurrency}
              onValueChange={(v) =>
                patch({
                  sourceCurrency: v as ScrapeOptions["sourceCurrency"],
                })
              }
            >
              <SelectTrigger id="sourceCurrency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="priceRounding">Price Rounding</Label>
            <Select
              value={value.priceRounding}
              onValueChange={(v) =>
                patch({ priceRounding: v as ScrapeOptions["priceRounding"] })
              }
            >
              <SelectTrigger id="priceRounding" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=".95">.95</SelectItem>
                <SelectItem value=".99">.99</SelectItem>
                <SelectItem value="5.00">5.00</SelectItem>
                <SelectItem value="9">Nearest 9 (whole $)</SelectItem>
                <SelectItem value="4or9">Nearest $4 or $9 (default)</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="retailMultiplier">Retail price multiplier</Label>
            <Input
              id="retailMultiplier"
              type="number"
              step="0.01"
              value={value.retailPriceMultiplier}
              onChange={(e) =>
                patch({
                  retailPriceMultiplier: Number(e.target.value) || 0,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="compareAtMultiplier">
              Compare-at price multiplier
            </Label>
            <Input
              id="compareAtMultiplier"
              type="number"
              step="0.01"
              value={value.compareAtPriceMultiplier}
              onChange={(e) =>
                patch({
                  compareAtPriceMultiplier: Number(e.target.value) || 0,
                })
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="cursor-pointer">
              <Checkbox
                checked={value.omitCompareAtPrice}
                onCheckedChange={(c) =>
                  patch({ omitCompareAtPrice: c === true })
                }
              />
              <span>Omit compare-at price</span>
            </Label>
          </div>
        </section>

        <Separator />

        {/* Inventory */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Default inventory</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="invType">Type</Label>
              <Select
                value={inv.type}
                onValueChange={(v) => {
                  if (v === "random") {
                    patch({
                      defaultInventory: { type: "random", min: 10, max: 50 },
                    });
                  } else {
                    patch({
                      defaultInventory: { type: "fixed", value: 25 },
                    });
                  }
                }}
              >
                <SelectTrigger id="invType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">Random range</SelectItem>
                  <SelectItem value="fixed">Fixed value</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inv.type === "random" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="invMin">Min</Label>
                  <Input
                    id="invMin"
                    type="number"
                    min={0}
                    value={inv.min}
                    onChange={(e) =>
                      patch({
                        defaultInventory: {
                          type: "random",
                          min: Math.max(0, Number(e.target.value) || 0),
                          max: inv.max,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invMax">Max</Label>
                  <Input
                    id="invMax"
                    type="number"
                    min={0}
                    value={inv.max}
                    onChange={(e) =>
                      patch({
                        defaultInventory: {
                          type: "random",
                          min: inv.min,
                          max: Math.max(0, Number(e.target.value) || 0),
                        },
                      })
                    }
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="invValue">Value</Label>
                <Input
                  id="invValue"
                  type="number"
                  min={0}
                  value={inv.value}
                  onChange={(e) =>
                    patch({
                      defaultInventory: {
                        type: "fixed",
                        value: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invPolicy">Inventory policy</Label>
              <Select
                value={value.inventoryPolicy}
                onValueChange={(v) =>
                  patch({
                    inventoryPolicy: v as "continue" | "deny",
                  })
                }
              >
                <SelectTrigger id="invPolicy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deny">Deny when out of stock</SelectItem>
                  <SelectItem value="continue">
                    Continue selling when out of stock
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Label className="cursor-pointer">
                <Checkbox
                  checked={value.publishToAllChannels}
                  onCheckedChange={(c) =>
                    patch({ publishToAllChannels: c === true })
                  }
                />
                <span>Publish to all channels</span>
              </Label>
              <Label className="cursor-pointer">
                <Checkbox
                  checked={value.generateSku}
                  onCheckedChange={(c) => patch({ generateSku: c === true })}
                />
                <span>Generate SKU</span>
              </Label>
            </div>
          </div>
        </section>

        <Separator />

        {/* Upload */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Shopify upload</h3>
          <Label className="cursor-pointer">
            <Checkbox
              checked={value.autoUpload}
              onCheckedChange={(c) => patch({ autoUpload: c === true })}
            />
            <span>Auto-upload to Shopify after scrape</span>
          </Label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uploadConnId">Connection</Label>
              {connections.length === 0 && connectionsLoaded ? (
                <p className="text-xs text-muted-foreground">
                  No connections yet.{" "}
                  <Link
                    href="/settings"
                    className="underline-offset-4 hover:underline"
                  >
                    Set one up in Settings.
                  </Link>
                </p>
              ) : (
                <Select
                  value={value.uploadConnectionId ?? ""}
                  onValueChange={(v) =>
                    patch({ uploadConnectionId: v || undefined })
                  }
                  disabled={!value.autoUpload || connections.length === 0}
                >
                  <SelectTrigger id="uploadConnId" className="w-full">
                    <SelectValue placeholder="Select a connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="templateSuffix">Template suffix</Label>
              <Input
                id="templateSuffix"
                value={value.templateSuffix ?? ""}
                onChange={(e) =>
                  patch({ templateSuffix: e.target.value || undefined })
                }
                placeholder="e.g. custom-template"
              />
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setOpen(false)}
          >
            Collapse
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
