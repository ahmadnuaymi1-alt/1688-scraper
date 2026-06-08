"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface RuleEditorValue {
  id?: string;
  name: string;
  prompt: string;
  model: string;
  enabled: boolean;
}

interface RuleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: RuleEditorValue | null;
  category: string;
  onSave: (value: RuleEditorValue) => Promise<void> | void;
}

const MODELS = [
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini (default, cheapest)" },
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
];

const DEFAULT_VALUE: RuleEditorValue = {
  name: "",
  prompt: "",
  model: "gpt-4.1-mini",
  enabled: true,
};

export function RuleEditor({
  open,
  onOpenChange,
  initial,
  category,
  onSave,
}: RuleEditorProps) {
  const [value, setValue] = useState<RuleEditorValue>(
    initial ?? DEFAULT_VALUE,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initial ?? DEFAULT_VALUE);
    }
  }, [open, initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.name.trim() || !value.prompt.trim()) return;
    setSaving(true);
    try {
      await onSave(value);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>
            Category: <span className="font-medium">{category}</span>
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={value.name}
              onChange={(e) =>
                setValue((v) => ({ ...v, name: e.target.value }))
              }
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-prompt">Prompt</Label>
            <Textarea
              id="rule-prompt"
              value={value.prompt}
              onChange={(e) =>
                setValue((v) => ({ ...v, prompt: e.target.value }))
              }
              rows={8}
              required
              className="font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-model">Model</Label>
              <Select
                value={value.model}
                onValueChange={(m) => setValue((v) => ({ ...v, model: m }))}
              >
                <SelectTrigger id="rule-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Enabled</Label>
              <div className="flex h-9 items-center">
                <Switch
                  checked={value.enabled}
                  onCheckedChange={(c) =>
                    setValue((v) => ({ ...v, enabled: c === true }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !value.name.trim() || !value.prompt.trim()}
            >
              {saving ? "Saving…" : initial?.id ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
