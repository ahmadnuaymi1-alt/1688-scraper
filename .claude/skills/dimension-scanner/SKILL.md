---
name: dimension-scanner
description: Use Playwright to log into seller.teemdrop.com, open a product page, click through every variant swatch to surface variant-specific imagery and text, and extract dimension annotations (cm/mm/inch/Chinese 长宽高) from the resulting corpus. Teemdrop mirrors 1688 listings but is bot-friendly — much more reliable than driving 1688 directly. Output is text only; the script does NOT write to the DB. Invoke when the user says "/dimension-scanner", "scan dimensions", or pastes a `seller.teemdrop.com` product URL and asks for dimensions or measurements. Credentials read from `.env.local` (TEEMDROP_EMAIL + TEEMDROP_PASSWORD).
---

# Dimension Scanner

## What this skill does

For a teemdrop product URL the user provides:
- Loads creds from `.env.local`.
- Logs into seller.teemdrop.com via Playwright (headed by default so you can watch).
- Navigates to the product page.
- Clicks every variant swatch / option button it can find (best-effort across a handful of common selectors). This surfaces variant-specific imagery and any per-variant text the SPA renders lazily.
- Collects the page's full innerText.
- Runs five dimension regex families against the text:
  - `L×W×H cm`
  - `W×H cm`
  - `L×W×H mm`
  - `inch / "` (English imperial)
  - `labeled cm` — "Height 28.5cm", "宽 15cm", etc.
- Prints any hits with surrounding snippet so the user can spot-check before copying values into the review page manually.

## Scope

- Read-only — does NOT write to the DB. The user manually updates `Variant.packagingDimensions` or extractedSpecs after reviewing the output.
- Text-based extraction only. If dimensions live ONLY inside swatch images (rendered as JPEGs with no overlay text), v1 will report no hits. OCR fallback is out of scope.
- Teemdrop only — does not attempt to drive 1688 directly. If the user only has a 1688 URL, ask whether they can locate the same product on teemdrop first.

## When to invoke

- "/dimension-scanner <url>"
- "Scan the dimensions for this product" + teemdrop URL
- "Use Playwright to check dimensions on https://seller.teemdrop.com/..."
- After the user mentions that the description-OCR / packing-section parser failed to find dimensions and they want a second pass.

## Inputs

One thing — a `seller.teemdrop.com` product URL. The script logs in with the credentials it reads from `.env.local`.

Optional flags:
- `--headless` — run without a visible browser window. Default: headed (so you can watch + interrupt).
- `--no-clicks` — skip the variant-swatch click loop. Use when the description text alone is enough or when swatches aren't loading.

## First-run setup

On first invocation, the Playwright Chromium browser may not be downloaded. If you see "Executable doesn't exist", run:

```bash
npx playwright install chromium
```

(~150MB download, one time.)

## Workflow

1. Confirm the user actually wants a scan (not a re-scrape of the 1688 page). If they're on /review for a product and want dimensions, the right tool is usually re-scrape; this skill is for **products that scraped without dimensions AND the user has located on teemdrop**.
2. Run:
   ```bash
   npx tsx scripts/_dimension-scanner.ts <teemdrop-url>
   ```
3. Report findings to the user with each hit + snippet. If zero hits, suggest manually opening the product page (the script left the browser open if headed) and looking at swatch images visually.

## Failure modes to handle

- **Login fails** — surface the error; ask the user to verify credentials in `.env.local` and that they can log in manually.
- **Chromium not installed** — instruct `npx playwright install chromium`.
- **No swatches clickable** — proceed with text-only extraction; report that variant swatches couldn't be opened.
- **Zero dimension hits** — recommend manual review of the description or swatch images; consider doing a fresh 1688 scrape (which has dimension-extraction tiers 1-4 baked in).

## Helper script

`scripts/_dimension-scanner.ts` (project-local). Edit the regex list or click-selector pool if Teemdrop's DOM changes.
