"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ScrapeOptionsPanel } from "@/components/imports/scrape-options-panel";
import {
  DEFAULT_SCRAPE_OPTIONS,
  ScrapeOptionsSchema,
  type ScrapeOptions,
} from "@/types/scrape-options";

interface ConnectionRow {
  id: string;
  label: string;
  storeDomain: string;
  isDefault: boolean;
}

interface EnvStatusEntry {
  key: string;
  isSet: boolean;
}

const LOCAL_DEFAULTS_KEY = "scraper1688.defaultOptions";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage Shopify connections, API keys, and default scrape options.
        </p>
      </div>
      <ConnectionsSection />
      <ApiKeysSection />
      <ScrapePresetsSection />
      <DefaultsSection />
    </div>
  );
}

interface PresetRow {
  id: string;
  name: string;
  options: string;
  isDefault: boolean;
  createdAt: string;
}

function ScrapePresetsSection() {
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scrape-presets");
      if (res.ok) {
        const json = await res.json();
        setPresets(Array.isArray(json?.presets) ? json.presets : []);
      } else {
        setPresets([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function summarize(optionsRaw: string): string {
    try {
      const raw = JSON.parse(optionsRaw);
      const parsed = ScrapeOptionsSchema.safeParse(raw);
      if (!parsed.success) return "(invalid options)";
      const o = parsed.data;
      const parts: string[] = [];
      parts.push(`autoUpload: ${o.autoUpload ? "on" : "off"}`);
      parts.push(`suggestedPricing: ${o.suggestedPricing ? "on" : "off"}`);
      return parts.join(" · ");
    } catch {
      return "(unreadable)";
    }
  }

  async function handleSetDefault(p: PresetRow) {
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/scrape-presets/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(`"${p.name}" set as default`);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(p: PresetRow) {
    const name = renameValue.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/scrape-presets/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(`Renamed to "${name}"`);
      setRenamingId(null);
      setRenameValue("");
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(p: PresetRow) {
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/scrape-presets/${p.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Deleted "${p.name}"`);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scrape Presets</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No presets yet. Save one from the Imports page.
          </p>
        ) : (
          <ul className="space-y-2">
            {presets.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <div className="flex-1 min-w-[200px]">
                  {renamingId === p.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="max-w-xs"
                        disabled={busyId === p.id}
                      />
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => handleRename(p)}
                        disabled={busyId === p.id || !renameValue.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue("");
                        }}
                        disabled={busyId === p.id}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.isDefault && (
                          <Badge className="text-xs">default</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {summarize(p.options)}
                      </div>
                    </>
                  )}
                </div>
                {renamingId !== p.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => handleSetDefault(p)}
                      disabled={busyId === p.id || p.isDefault}
                    >
                      {p.isDefault ? "Default" : "Set as default"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => {
                        setRenamingId(p.id);
                        setRenameValue(p.name);
                      }}
                      disabled={busyId === p.id}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => handleDelete(p)}
                      disabled={busyId === p.id}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionsSection() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [storeDomain, setStoreDomain] = useState("");
  // Two-mode auth: "credentials" (Client ID + Client Secret, server exchanges
  // them via OAuth client_credentials grant) or "token" (paste a long-lived
  // shpat_*/shpca_* access token directly).
  const [authMode, setAuthMode] = useState<"credentials" | "token">("credentials");
  const [accessToken, setAccessToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections");
      if (res.ok) {
        const json = await res.json();
        setConnections(
          Array.isArray(json?.connections) ? json.connections : [],
        );
      } else {
        setConnections([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !storeDomain.trim()) {
      toast.error("Label and store domain are required");
      return;
    }
    if (authMode === "credentials") {
      if (!clientId.trim() || !clientSecret.trim()) {
        toast.error("Client ID and Client Secret are required");
        return;
      }
    } else {
      if (!accessToken.trim()) {
        toast.error("Access token is required");
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload =
        authMode === "credentials"
          ? { label, storeDomain, clientId, clientSecret }
          : { label, storeDomain, accessToken };
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(
        authMode === "credentials"
          ? "Connection added — exchanged credentials for an access token"
          : "Connection added",
      );
      setLabel("");
      setStoreDomain("");
      setAccessToken("");
      setClientId("");
      setClientSecret("");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(c: ConnectionRow) {
    if (!confirm(`Delete connection "${c.label}"?`)) return;
    try {
      const res = await fetch(`/api/connections/${c.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Connection deleted");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Shopify connections</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connections yet.</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.label}</span>
                    {c.isDefault && (
                      <Badge className="text-xs">default</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.storeDomain}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(c)}
                >
                  <Trash2 className="mr-1 h-3 w-3" /> Delete
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form className="space-y-4" onSubmit={handleAdd}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="conn-label">Label</Label>
              <Input
                id="conn-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My store"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conn-domain">Store domain</Label>
              <Input
                id="conn-domain"
                value={storeDomain}
                onChange={(e) => setStoreDomain(e.target.value)}
                placeholder="my-store.myshopify.com"
              />
            </div>
          </div>

          {/* Auth-mode toggle: Custom App credentials (preferred — server does
              the OAuth exchange) vs paste-an-already-minted access token. */}
          <div className="space-y-2">
            <Label>Authentication</Label>
            <div className="inline-flex rounded-md border bg-muted p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setAuthMode("credentials")}
                className={`rounded-sm px-3 py-1 transition-colors ${
                  authMode === "credentials"
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Custom App credentials
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("token")}
                className={`rounded-sm px-3 py-1 transition-colors ${
                  authMode === "token"
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Paste access token
              </button>
            </div>
          </div>

          {authMode === "credentials" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="conn-client-id">Client ID</Label>
                <Input
                  id="conn-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Custom App API key"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conn-client-secret">Client Secret</Label>
                <Input
                  id="conn-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Custom App API secret"
                  autoComplete="off"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Server exchanges these for an access token via Shopify&apos;s OAuth
                client_credentials grant. The credentials aren&apos;t stored —
                only the resolved token.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="conn-token">Access token</Label>
              <Input
                id="conn-token"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="shpat_..."
                autoComplete="off"
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting
                ? authMode === "credentials"
                  ? "Exchanging credentials…"
                  : "Adding…"
                : "Add connection"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ApiKeysSection() {
  const [entries, setEntries] = useState<EnvStatusEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/env-status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const arr: EnvStatusEntry[] = Array.isArray(json?.entries)
          ? json.entries
          : [];
        setEntries(arr);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">API keys</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries && entries.length > 0 ? (
          <ul className="space-y-1">
            {entries.map((e) => (
              <li
                key={e.key}
                className="flex items-center justify-between border-b border-border/40 py-2 text-sm last:border-b-0"
              >
                <code className="font-mono text-xs">{e.key}</code>
                {e.isSet ? (
                  <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                    Set ✓
                  </Badge>
                ) : (
                  <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
                    Missing ✗
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Env status endpoint not available yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DefaultsSection() {
  const [options, setOptions] = useState<ScrapeOptions>(DEFAULT_SCRAPE_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_DEFAULTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setOptions({ ...DEFAULT_SCRAPE_OPTIONS, ...parsed });
        }
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      localStorage.setItem(LOCAL_DEFAULTS_KEY, JSON.stringify(options));
      // Best-effort server-side save; ignore failures.
      try {
        await fetch("/api/settings/defaults", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options }),
        });
      } catch {
        // intentional
      }
      toast.success("Defaults saved");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default scrape options</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <ScrapeOptionsPanel
        value={options}
        onChange={setOptions}
        defaultOpen={true}
      />
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save defaults"}
        </Button>
      </div>
    </div>
  );
}
