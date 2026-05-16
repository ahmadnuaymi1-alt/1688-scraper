"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Save as SaveIcon } from "lucide-react";
import {
  RuleEditor,
  type RuleEditorValue,
} from "@/components/rules/rule-editor";

type Category = "title" | "description" | "tags" | "image" | "seo";

const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: "title", label: "Title" },
  { value: "description", label: "Description" },
  { value: "tags", label: "Tags" },
  { value: "image", label: "Image" },
  { value: "seo", label: "SEO" },
];

interface RuleRow {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  config: string;
}

interface TemplateRow {
  id: string;
  name: string;
  category: string;
  config: string;
  isDefault: boolean;
}

interface RuleConfig {
  prompt?: string;
  model?: string;
  [key: string]: unknown;
}

function parseConfig(raw: string): RuleConfig {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as RuleConfig) : {};
  } catch {
    return {};
  }
}

export default function RulesPage() {
  const [active, setActive] = useState<Category>("title");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
        <p className="text-sm text-muted-foreground">
          Configure AI transformation rules per content category.
        </p>
      </div>

      <Tabs
        value={active}
        onValueChange={(v) => setActive(v as Category)}
      >
        <TabsList>
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c.value} value={c.value}>
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {CATEGORIES.map((c) => (
          <TabsContent key={c.value} value={c.value} className="mt-4 space-y-6">
            <CategorySection category={c.value} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CategorySection({ category }: { category: Category }) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RuleEditorValue | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, tRes] = await Promise.all([
        fetch(`/api/rules?category=${category}`),
        fetch(`/api/rules/templates?category=${category}`),
      ]);
      if (rRes.ok) {
        const json = await rRes.json();
        setRules(Array.isArray(json?.rules) ? json.rules : []);
      } else {
        setRules([]);
      }
      if (tRes.ok) {
        const json = await tRes.json();
        setTemplates(Array.isArray(json?.templates) ? json.templates : []);
      } else {
        setTemplates([]);
      }
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleSaveRule(value: RuleEditorValue) {
    try {
      const body = {
        name: value.name,
        category,
        enabled: value.enabled,
        config: { prompt: value.prompt, model: value.model },
      };
      const url = value.id ? `/api/rules/${value.id}` : `/api/rules`;
      const method = value.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success(value.id ? "Rule saved" : "Rule created");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      throw err;
    }
  }

  async function toggleEnabled(rule: RuleRow, enabled: boolean) {
    try {
      const res = await fetch(`/api/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function deleteRule(rule: RuleRow) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      const res = await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Rule deleted");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function saveAsTemplate(rule: RuleRow) {
    try {
      const res = await fetch(`/api/rules/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rule.name,
          category,
          config: parseConfig(rule.config),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Saved as template");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function useAsDefault(template: TemplateRow) {
    try {
      const res = await fetch(`/api/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          category,
          enabled: true,
          config: parseConfig(template.config),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast.success("Applied to your rules");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    }
  }

  function openNewEditor() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEditEditor(rule: RuleRow) {
    const cfg = parseConfig(rule.config);
    setEditing({
      id: rule.id,
      name: rule.name,
      prompt: typeof cfg.prompt === "string" ? cfg.prompt : "",
      model: typeof cfg.model === "string" ? cfg.model : "gpt-4.1-mini",
      enabled: rule.enabled,
    });
    setEditorOpen(true);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">Your rules</CardTitle>
          <Button size="sm" onClick={openNewEditor}>
            <Plus className="mr-1 h-3 w-3" /> New rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rules yet. Create one or import a template below.
            </p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => {
                const cfg = parseConfig(rule.config);
                return (
                  <li
                    key={rule.id}
                    className="flex flex-wrap items-start gap-3 rounded-md border p-3"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rule.name}</span>
                        {!rule.enabled && (
                          <Badge variant="outline" className="text-xs">
                            disabled
                          </Badge>
                        )}
                      </div>
                      {cfg.prompt && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {cfg.prompt}
                        </p>
                      )}
                      {cfg.model && (
                        <p className="text-xs text-muted-foreground/70">
                          Model: <code>{cfg.model}</code>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(c) => toggleEnabled(rule, c === true)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditEditor(rule)}
                      >
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveAsTemplate(rule)}
                      >
                        <SaveIcon className="mr-1 h-3 w-3" /> Save as template
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteRule(rule)}
                      >
                        <Trash2 className="mr-1 h-3 w-3" /> Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template library</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates available for this category.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => {
                const cfg = parseConfig(t.config);
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-start gap-3 rounded-md border p-3"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        {t.isDefault && (
                          <Badge className="text-xs">default</Badge>
                        )}
                      </div>
                      {cfg.prompt && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {cfg.prompt}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => useAsDefault(t)}
                    >
                      Use as default
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <RuleEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        category={category}
        onSave={handleSaveRule}
      />
    </div>
  );
}
