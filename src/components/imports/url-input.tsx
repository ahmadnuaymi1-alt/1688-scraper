"use client";

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

const URL_REGEX = /^https?:\/\/(detail\.|m\.)?1688\.com\//;

export interface UrlValidationResult {
  urls: string[];
  invalidCount: number;
  invalidLines: number[];
  hasInvalid: boolean;
}

export function validateUrls(raw: string): UrlValidationResult {
  const lines = raw.split(/\r?\n/);
  const urls: string[] = [];
  const invalidLines: number[] = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (URL_REGEX.test(trimmed)) {
      urls.push(trimmed);
    } else {
      invalidLines.push(idx + 1);
    }
  });
  return {
    urls,
    invalidCount: invalidLines.length,
    invalidLines,
    hasInvalid: invalidLines.length > 0,
  };
}

interface UrlInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function UrlInput({ value, onChange, disabled }: UrlInputProps) {
  const validation = useMemo(() => validateUrls(value), [value]);
  const totalLines = useMemo(
    () => value.split(/\r?\n/).filter((l) => l.trim().length > 0).length,
    [value],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="urls">1688 Product URLs</Label>
        <span className="text-xs text-muted-foreground">
          {validation.urls.length} valid
          {validation.hasInvalid && (
            <span className="ml-2 text-destructive">
              {validation.invalidCount} invalid
            </span>
          )}
          <span className="ml-2 text-muted-foreground/70">
            of {totalLines}
          </span>
        </span>
      </div>
      <Textarea
        id="urls"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://detail.1688.com/offer/123456.html
https://m.1688.com/offer/789012.html"
        rows={8}
        disabled={disabled}
        className={cn(
          "min-h-40 font-mono text-sm",
          validation.hasInvalid && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
        )}
      />
      <p className="text-xs text-muted-foreground">
        Paste one URL per line. Must match{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
          https://(detail.|m.)?1688.com/
        </code>
      </p>
    </div>
  );
}
