---
name: hero-image-creator
description: Generate luxury studio hero images by driving higgsfield.ai's Nano Banana Pro image-to-image flow through a stealthed Playwright browser, fed with each variant's existing source image as the reference. Works on a locally scraped product on the review page (`/review/<productId>`). Use whenever the user asks to "make hero images" / "generate heroes" / "create hero shots" / "render hero images" / "do higgsfield heroes" for any product they show me, OR pastes a review URL and asks for hero images, OR says "/hero-image-creator". Produces ONE hero per unique source image (sister variants sharing a swatch get attached to the same hero), saved to Supabase, with `ProductImage` rows tied to variants so the heroes show on the review page. Runs in `--headed --parallel` mode by default so you can watch progress and solve any occasional security check manually in the visible browser.
---

# Hero Image Creator (Higgsfield)

## What this skill does

Drives Higgsfield's web UI through Playwright to generate one hero image per unique variant source image. The wrapper handles file uploads, prompt typing, parallel tab generation, and the DB attach back to ProductImage rows.

Input: a locally scraped product's review URL (or bare `productId` cuid). The script reads visible variants (`isHidden=false`) from Prisma, dedups variants that share the same source thumbnail (typical 1688 pattern — sister variants like "Red / Rechargeable" + "Red / USB" share one red swatch), runs one Higgsfield generation per unique source, uploads each result to Supabase, and creates `ProductImage` rows (`imageType="hero-flat"`, with the right `variantId` per sister).

**Scope**: heroes only. No lifestyles, no closeups, no description rewriting. No live-Shopify mode here — this skill is for products in the local DB.

## When to invoke

Invoke whenever the user:
- Says "/hero-image-creator", "do higgsfield heroes", or asks me to invoke this skill by name.
- Pastes a **review URL** (`http://localhost:PORT/review/<productId>`) and asks for "hero images" / "heroes" / "hero shots" / "render heroes" / "make heroes".
- Has just finished a scrape and says "now make hero images" or similar.

**Do NOT invoke**:
- For products where every visible variant lacks a featured source image. Suggest manually assigning featured images via the review UI first, or re-scraping.
- As part of a fresh scrape — this skill is **post-scrape**, manual hero generation.

## Inputs the skill needs

One thing: a `productId` (cuid) or a review URL containing `/review/<productId>`. The script auto-detects.

## Pipeline: Higgsfield via Playwright

- **Model:** Higgsfield's `nano-banana-pro` (their web UI's default image-to-image model).
- **Driver:** Playwright (`playwright-extra` + `puppeteer-extra-plugin-stealth`) launching the **user's installed real Chrome** with a persistent profile at `%TEMP%/scene/higgsfield-session`. The profile carries cookies, localStorage, IndexedDB, service workers — so Higgsfield sees a returning logged-in user every run.
- **Resolution:** 2K, aspect ratio 1:1. Set as a one-time UI click before the prompt loop.
- **Prompt:** lives in [src/lib/hero/prompt.ts](src/lib/hero/prompt.ts) as the exported `HERO_PROMPT` constant. The script imports it directly. Edit the file if the prompt needs to change. The prompt covers backdrop color, lighting, framing, product fidelity, mounting-surface rules (flush-mount → ceiling, sconce → wall, floor lamp → floor, table/desk → tabletop), and a positioning template.
- **Positioning template:** a 1024×1024 PNG at `%TEMP%/scene/v25-refs/positioning-template.png` is uploaded as a second reference alongside each variant's source swatch. The prompt references it as "Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output."
- **Stealth:** `playwright-extra` + stealth plugin patches ~30 fingerprint leaks (`navigator.webdriver`, plugin list, canvas/WebGL, User-Agent, etc.) before any Higgsfield JS runs. Reduces frequency of bot-detection security checks but doesn't eliminate them — when one appears, the user solves it manually in the visible browser.
- **Parallel mode:** N tabs open concurrently, each generating one hero. A shared `claimedUrls` set prevents two tabs from claiming the same generated image URL from Higgsfield's account-shared gallery feed. Wall time for 6 heroes: ~60-90 seconds.
- **Failure auto-retry:** if a tab's generation comes back with Higgsfield's "Failed — Credits refunded" + Retry button, the wrapper auto-clicks Retry up to 2 times per prompt before giving up. No code change needed by the operator.
- **Slug uniqueness:** each prompt's slug includes the variantId suffix (`v25_hero_${idx}_${variantId6}_${safeSlug(title)}`) so non-ASCII variant titles (Chinese, etc.) that strip to empty in `safeSlug` don't collide with another variant's filename and overwrite each other in Supabase.

## Workflow

When invoked, execute:

1. **Pre-flight:** kill any stale Chrome processes from previous runs whose command line contains `higgsfield-session` — they hold the profile lock and a new Playwright launch will error out. Use PowerShell:
   ```ps1
   Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
     Where-Object { $_.CommandLine -like "*higgsfield-session*" } |
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
   ```
2. **Run the script:** `npx tsx scripts/probe-hero-higgsfield-v25.ts <reviewURL> --headed --parallel`
   - `--headed` is essential — the user wants to see the browser AND occasionally solve a "Verify you're human" check manually.
   - `--parallel` opens one tab per unique source image and runs them concurrently.
3. **Watch the run.** The script streams per-prompt progress to stdout. If a tab gets stuck on a security check, the user solves it in the visible browser and the script continues.
4. **Report when done:**
   - `N/N succeeded` count
   - Wall time
   - Number of variants attached in the DB
   - Review URL: `http://localhost:3000/review/<productId>`
   - If any variants got skipped ("has no source image"), list them and suggest the user manually assign a featured image or re-scrape.

## Failure modes the wrapper handles

- **Higgsfield "Failed — Credits refunded"** with Retry button → wrapper auto-clicks Retry (≤ 2 attempts per prompt). User does not need to intervene.
- **Variant has no source image** (no `featuredImageId` and no ProductImage row with that variantId, after the hero-flat filter) → script logs `Variant X has no source image — skipping` and continues with the rest. Suggest re-scraping or manually picking a featured image.
- **Profile lock from prior run** → pre-flight kill above clears it.
- **Slug collision** (Chinese-only titles) → already fixed via variantId suffix in the slug.

## Failure modes the wrapper does NOT handle (operator decides)

- **"Verify you're human" / hCaptcha / Turnstile widget** appears in the live browser — the user solves it manually. The wrapper detects "Retry" buttons but not full captcha widgets; rely on the headed window.
- **Higgsfield site outage / login expired** → user signs back in once; the persistent profile remembers it from then on.
- **All 2 retries failed for one prompt** → script reports `[N/N] FAIL → Generation timed out` and dumps debug screenshots to `%TEMP%/scene/output/_higgsfield-debug-*.png`. Re-run the script — the wrapper detects which variants still need heroes (those whose `featuredImageId` doesn't yet point to a hero-flat row) and only re-runs those.

## Critical files

- `scripts/probe-hero-higgsfield-v25.ts` — the entry point (variant lookup → reference download → driving the wrapper → DB attach).
- `scripts/_higgsfield-lifestyle.ts` — the Playwright wrapper. Hosts `runHiggsfieldBatch`, the stealth + persistent-profile launch, parallel-tab orchestration, claimed-URL coordination, retry detection, and progress screenshots. Also used by lifestyle generation.
- [src/lib/hero/prompt.ts](src/lib/hero/prompt.ts) — the single source of truth for the hero prompt. Edit here to change what the model is asked for.

## Invocation in this project

```bash
# Clear stale Chrome holding the profile (PowerShell, one-liner)
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*higgsfield-session*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Then run
npx tsx scripts/probe-hero-higgsfield-v25.ts http://localhost:3000/review/<productId> --headed --parallel
```

The script auto-loads `.env.local` for Supabase credentials.
