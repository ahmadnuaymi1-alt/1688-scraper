---
name: hero-image-creator
description: Generate luxury studio hero images by driving higgsfield.ai's Nano Banana Pro image-to-image flow through the official Higgsfield CLI (`higgsfield generate create nano_banana_2 …`), fed with each variant's existing source image + a positioning template as two `media_input` references. Works on a locally scraped product on the review page (`/review/<productId>`). Use whenever the user asks to "make hero images" / "generate heroes" / "create hero shots" / "render hero images" / "do higgsfield heroes" for any product they show me, OR pastes a review URL and asks for hero images, OR says "/hero-image-creator". Produces ONE hero per unique source image (sister variants sharing a swatch get attached to the same hero), saved to Supabase, with `ProductImage` rows tied to variants so the heroes show on the review page. No browser involved — pure CLI invocations, parallelized via a concurrency cap.
---

# Hero Image Creator (Higgsfield CLI)

## What this skill does

Drives the official Higgsfield CLI (`higgsfield upload create …` + `higgsfield generate create nano_banana_2 …`) to generate one hero image per unique variant source image. The wrapper handles uploads, generation, and the DB attach back to ProductImage rows.

Input: a locally scraped product's review URL (or bare `productId` cuid). The script reads visible variants (`isHidden=false`) from Prisma, dedups variants that share the same source thumbnail (typical 1688 pattern — sister variants like "Red / Rechargeable" + "Red / USB" share one red swatch), runs one Higgsfield generation per unique source, uploads each result to Supabase, and creates `ProductImage` rows (`imageType="hero-flat"`, with the right `variantId` per sister).

**Scope**: heroes only. No lifestyles, no closeups, no description rewriting. Two modes:
- **Mode A** — local DB product (most common). Triggered by `/review/<id>` URL or bare cuid.
- **Mode B** — live Shopify product. Triggered by a Shopify admin/storefront URL or `gid://shopify/Product/...`.

## When to invoke

Invoke whenever the user:
- Says "/hero-image-creator", "do higgsfield heroes", or asks me to invoke this skill by name.
- Pastes a **review URL** (`http://localhost:PORT/review/<productId>`) and asks for "hero images" / "heroes" / "hero shots" / "render heroes" / "make heroes".
- Pastes a Shopify product URL and asks for heroes (Mode B).
- Has just finished a scrape and says "now make hero images" or similar.

**Do NOT invoke**:
- For products where every visible variant lacks a featured source image. Suggest manually assigning featured images via the review UI first, or re-scraping.
- As part of a fresh scrape — this skill is **post-scrape**, manual hero generation.

## Inputs the skill needs

One thing: a `productId` (cuid), a review URL containing `/review/<productId>`, or a Shopify product URL/GID. The script auto-detects the mode.

## Pipeline: Higgsfield CLI

- **Model:** Higgsfield's `nano_banana_2` (Nano Banana Pro), 2K resolution, 1:1 aspect ratio.
- **Driver:** the official `higgsfield` CLI invoked via `child_process.spawn` with Windows-safe quoting (each arg double-quoted, inner `"` escaped as `""`, then run with `shell: true`). No browser, no profile, no captchas — the CLI is bound to the logged-in account via its own credentials.
- **Prompt:** lives in [src/lib/hero/prompt.ts](src/lib/hero/prompt.ts) as the exported `HERO_PROMPT` constant. The script imports it directly and collapses newlines into spaces (cmd.exe doesn't survive literal newlines inside quoted args). Edit the file if the prompt needs to change. The prompt covers backdrop color, lighting, framing, product fidelity, mounting-surface rules (flush-mount → ceiling, sconce → wall, floor lamp → floor, table/desk → tabletop), and the positioning template.
- **Positioning template:** a 1024×1024 PNG at `%TEMP%/scene/v25-refs/positioning-template.png` is uploaded ONCE per run and passed alongside each variant's source swatch in `--input_images` as `[{id: variantUploadId, type: "media_input"}, {id: templateUploadId, type: "media_input"}]`. The prompt references it as "Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output."
- **Reference upload caching:** the variant ref is downloaded once to `%TEMP%/hero-cli/refs/<refKey>.png` and uploaded once per group. The positioning template uploads once per script invocation.
- **Concurrency:** default 6 parallel `generate create --wait` invocations via a tiny in-process limiter. Tune with `--concurrency N`.
- **Idempotency:** before generating, the script counts ANY existing `ProductImage` row with `imageType IN ("hero", "hero-flat")` and skips groups whose sister variants already have one. The same filter is applied to the source-image selection — a previous hero is never picked as the source for a new hero.
- **Slug uniqueness:** each group's storage path uses a sanitized `sourceKey` (storagePath || sourceUrl) so two groups with different source images never collide. Non-ASCII variant titles (Chinese, etc.) are safe because the slug derives from the source path, not the title.

## Workflow

When invoked, execute:

1. **Run the script:**
   ```bash
   npx tsx scripts/_hero-image-creator.ts <reviewURL>
   # tune concurrency:
   npx tsx scripts/_hero-image-creator.ts <reviewURL> --concurrency 3
   # Mode B (Shopify):
   npx tsx scripts/_hero-image-creator.ts https://<store>.myshopify.com/admin/products/<id>
   ```
2. **Watch the run.** The script streams per-group progress to stdout (`(N/M) <colorLabel> → OK (Xs)`).
3. **Report when done:**
   - Unique heroes generated / variants attached
   - Wall time
   - Cost estimate (~$0.02/hero)
   - Review URL: `http://localhost:3000/review/<productId>`
   - If any variants got skipped ("no source image"), list them and suggest the user manually assign a featured image or re-scrape.

## Failure modes

- **Positioning template missing** at `%TEMP%/scene/v25-refs/positioning-template.png` → script exits with a clear error. Provision it before running.
- **Variant has no source image** (no `featuredImageId` and no ProductImage row with that variantId, after the hero/hero-flat filter) → script logs `SKIP (no source image)` and continues with the rest. Suggest re-scraping or manually picking a featured image.
- **CLI generate failure** (rate limit, account flag, transient backend error) → that group is logged as FAIL with the CLI's stderr tail. Other groups continue. Re-run — the idempotency check will skip groups that already succeeded and only retry the failures.
- **CLI binary missing** → "command not found" surfaces from the spawn. Install Higgsfield's CLI and ensure `higgsfield` is on PATH.

## Critical files

- [scripts/_hero-image-creator.ts](scripts/_hero-image-creator.ts) — entry point (Mode A + Mode B, variant lookup, dedup, idempotency, parallel CLI fan-out, DB attach).
- [scripts/_higgsfield-cli.ts](scripts/_higgsfield-cli.ts) — shared CLI wrapper (`higgsfieldUpload`, `higgsfieldGenerate`, `makeLimit`, `runHiggsfieldCliBatch`). Shared with lifestyle generation.
- [src/lib/hero/prompt.ts](src/lib/hero/prompt.ts) — single source of truth for the hero prompt. Edit here to change what the model is asked for.

## Invocation in this project

```bash
# Mode A (local DB product)
npx tsx scripts/_hero-image-creator.ts http://localhost:3000/review/<productId>

# Throttle if hitting plan limits
npx tsx scripts/_hero-image-creator.ts http://localhost:3000/review/<productId> --concurrency 2

# Mode B (live Shopify product)
npx tsx scripts/_hero-image-creator.ts https://<store>.myshopify.com/admin/products/<id> --connection <connId>
```

The script auto-loads `.env.local` for Supabase credentials.
