---
name: hero-image-creator
description: Generate luxury studio hero images using kie.ai's Seedream 5 Lite Image-to-Image, fed with each variant's existing source image as the reference. Works with TWO input sources — (1) a locally scraped product on the review page (`/review/<productId>`), or (2) a live Shopify product (admin URL / storefront URL / product handle). Use whenever the user asks to "make hero images" / "generate heroes" / "create hero shots" / "render hero images" for any product they show me, OR pastes a review URL or Shopify product URL and asks for hero images, OR says "/hero-image-creator". Produces ONE hero per variant, saved to Supabase. For local-DB products it also writes ProductImage rows tied to variants (visible on the review page). For Shopify products it prints the new hero URLs for you to upload back manually (or via the existing UI flow).
---

# Hero Image Creator

## What this skill does

Two input modes:

### Mode A — Local-DB product (review page)
For a product already in our DB:
- Reads the product's variants (visible only — `isHidden=false`) + their linked source images from Prisma.
- **Dedupes by source image**: variants sharing the same source thumbnail (typical 1688 pattern — e.g. "Red / Rechargeable" + "Red / USB" both reference the same red-color swatch) get ONE kie call and ONE generated hero. Sister variants are attached to that hero via duplicate ProductImage rows.
- Uploads outputs to Supabase + creates `ProductImage` rows with `imageType="hero"` and the right `variantId` per sister.
- The heroes show up on `/review/<productId>` bound to their variant.

### Mode B — Live Shopify product
For a product already on a Shopify store:
- Resolves a ShopifyConnection (default if not specified).
- Fetches the product via Admin API: variants + their currently-assigned image GIDs + the full product image list.
- **Dedupes by image GID**: variants sharing the same Shopify featured image get ONE kie call. The resulting hero URL is reported for every sister.
- Uploads outputs to Supabase and **prints the public hero URLs**.
- Does NOT push the heroes back to Shopify automatically — those URLs can be uploaded via the existing UI flow or a separate upload step. (This is a deliberate safety bound — auto-uploading new variant images to a live store is destructive and should be a separate explicit step.)

**Scope**: heroes only. No lifestyles, no closeups, no description rewriting.

## When to invoke

Invoke whenever the user:
- Says "/hero-image-creator" or asks me to invoke this skill by name.
- Pastes a **review URL** (`http://localhost:PORT/review/<productId>`) and asks for "hero images" / "heroes" / "hero shots".
- Pastes a **Shopify product URL** (admin: `https://*.myshopify.com/admin/products/<id>`, storefront: `https://*.myshopify.com/products/<handle>`, or just `<handle>` + a connection hint) and asks for hero images.
- Has just finished a scrape and says "now make hero images" or similar.

**Do NOT invoke**:
- For products with zero variant-linked images. Suggest re-scraping with the multi-variant linkage fix first (Mode A), or check that variants actually have images attached on Shopify (Mode B).
- As part of a fresh scrape — that's a separate scrape phase if you want it. This skill is for **post-scrape / post-upload**, manual hero gen.

## Inputs the skill needs

The user gives me **one** thing — I auto-detect which mode:

1. **Local mode**: a `productId` (cuid) or a review URL containing `/review/<productId>`.
2. **Shopify mode**: a Shopify product URL (admin or storefront) or `productGid` (`gid://shopify/Product/...`) or a `handle` + store URL.

If ambiguous, ask once. If "the product I just scraped" → find the most recent ready ScrapeJob's product → Mode A.

## Model + API (same for both modes)

- **Model identifier**: `seedream/5-lite-image-to-image`
- **Endpoint**: `POST https://api.kie.ai/api/v1/jobs/createTask`
- **Auth**: `Authorization: Bearer $KIE_API_KEY`
- **Body shape**:
  ```json
  {
    "model": "seedream/5-lite-image-to-image",
    "input": {
      "prompt": "<the luxury hero prompt below>",
      "image_urls": ["<variant-source-url>"],
      "aspect_ratio": "1:1",
      "quality": "basic",
      "nsfw_checker": false
    }
  }
  ```
- **Poll**: `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<taskId>` every 5s until `state` is `success` or `fail`.
- **Note on field name**: `image_urls` (plural, snake_case) — NOT `image_input` like nano-banana / gpt-image.
- **Pricing**: Seedream 5 Lite at "basic" quality is ~$0.02/image at 2K.

## The hero prompt (verbatim — do not modify)

```
Generate a luxury studio product hero shot of the product from the reference image.
BACKGROUND — STRICT:
- Pure flat solid fill, hex #D8D8D8 across the entire frame.
- NOT a gradient, NOT a vignette, NOT a paper-curve seamless, NOT a wall, NOT a textured backdrop.
- Identical pixel tone edge-to-edge — no lighting falloff, no color cast, no warmth/coolness shift.
CAMERA — STRICT:
- Front view with the product filing out the page.
- Eye-level perspective (camera height = product's vertical center).
- Square 1:1 frame.
- NO tilt, NO foreshortening, NO low-angle, NO overhead.
FRAMING — STRICT:
- Centered horizontally AND vertically taking up most of the page.
SHADOW:
- Soft subtle contact shadow directly beneath the product's base ONLY, no longer than ~10% of frame height, soft-edged, sitting in the same #D8D8D8 plane (no hard shadow line, no projected floor reflection).
PRODUCT FIDELITY:
- Preserve the EXACT product design, finish, color, proportions, and construction from the reference image — every component visible in the reference must appear in the output.
- For table lamps, floor lamps, bedside lamps, or any other free-standing lamp: do NOT show a power cable, charging cable, or USB cord anywhere in the frame. If the reference shows a cable, render the lamp as if it is cordless or the cable is fully tucked away. No visible cord, no cord shadow, no cord exit point at the base.
OUTPUT:
- ONE single photograph of the product in use (if a light then it needs to be turned on), edge-to-edge, no text, no watermarks, no UI overlays.
```

## Workflow

When invoked, execute:

1. **Detect input mode**:
   - Looks like a cuid OR a `localhost:PORT/review/<id>` URL → Mode A.
   - Looks like a `*.myshopify.com` URL or `gid://shopify/Product/...` → Mode B.
2. **Run** `scripts/_hero-image-creator.ts <input>` — single script handles both modes. Pass the productId / Shopify URL as the first arg. Optional second arg: `--connection <id>` to pin a specific ShopifyConnection (defaults to the user's default connection).
3. **Watch progress** via Bash + Monitor — script prints per-variant status with timings.
4. **Report**:
   - Mode A: number of heroes inserted into the DB, review URL.
   - Mode B: number of heroes generated, the Supabase URLs (one per variant), the Shopify product URL.
   - Total kie cost (count × $0.02).
   - Skipped/failed variants with reasons.

## Failure modes to handle

- **No variant-linked source images**: skip with warning. Don't fail the whole skill.
- **Shopify connection missing / no default**: prompt the user to set up a connection (or pass `--connection <id>`).
- **Shopify variant has no `image.id`**: skip — there's nothing to reference. Don't try to fall back to the product's featured image (it may not represent the variant).
- **kie content-filter rejection** ("flagged as sensitive"): log + skip. Don't auto-retry.
- **kie 5xx**: one retry after 30s, then surface and continue with remaining variants.

## Invocation in this project

```bash
npx tsx scripts/_hero-image-creator.ts <input>            # local productId or review URL
npx tsx scripts/_hero-image-creator.ts <shopify-url>      # Mode B
npx tsx scripts/_hero-image-creator.ts <input> --connection <id>
```

The script auto-loads `.env.local` so no `--env-file` flag is needed.

## Helper script

`scripts/_hero-image-creator.ts` (project-local) handles both input modes. Edit it if behavior needs to change. The skill instructions stay in this file.
