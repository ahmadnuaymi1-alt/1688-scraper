"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload } from "lucide-react";
import { toast } from "sonner";

interface Connection {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * Page-level Upload-to-Shopify control for the review page top header.
 *
 * Self-contained: fetches /api/connections on mount, auto-selects the
 * default (or the only one), shows a Select only if 2+ connections exist.
 * Click → POST /api/uploads synchronously. Toast on success/error.
 *
 * The existing in-toolbar Upload control inside ProductEditor stays in
 * place; this one just surfaces the same action at the page top-right.
 */
export function UploadToShopifyButton({ productId }: { productId: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/connections");
        if (!res.ok) return;
        const json = (await res.json()) as { connections?: Connection[] };
        const list = Array.isArray(json.connections) ? json.connections : [];
        if (!mounted) return;
        setConnections(list);
        const def = list.find((c) => c.isDefault) ?? list[0];
        if (def) setSelectedId(def.id);
      } catch {
        // silent — UI shows "no connections" state
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function upload() {
    if (!selectedId) {
      toast.error("Pick a Shopify connection first");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, connectionId: selectedId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const label = connections.find((c) => c.id === selectedId)?.label ?? "Shopify";
      toast.success(`Uploaded to ${label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <Button size="sm" disabled>
        <Upload className="mr-1 h-3 w-3" /> Loading…
      </Button>
    );
  }

  if (connections.length === 0) {
    return (
      <Button size="sm" disabled title="Add a Shopify connection in Settings">
        <Upload className="mr-1 h-3 w-3" /> Upload to Shopify
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {connections.length > 1 && (
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger size="sm" className="min-w-36">
            <SelectValue placeholder="Pick connection" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
                {c.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        size="sm"
        onClick={upload}
        disabled={uploading || !selectedId}
        title={`Upload this product to ${
          connections.find((c) => c.id === selectedId)?.label ?? "Shopify"
        }`}
      >
        <Upload className="mr-1 h-3 w-3" />
        {uploading ? "Uploading…" : "Upload to Shopify"}
      </Button>
    </div>
  );
}
