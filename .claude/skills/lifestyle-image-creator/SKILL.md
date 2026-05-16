---
name: lifestyle-image-creator
description: Generate 6 editorial lifestyle / in-context product photographs using Google's Nano Banana Pro (Gemini 3 Pro Image) via kie.ai. Each image uses one of the product's existing hero images as reference, cycles through variants for variety across the 6 outputs, and varies camera angle per image (eye-level wide, low three-quarter, top-down flat-lay, over-the-shoulder, ambient room, close-up detail). Output is 1:1 aspect ratio at 1K resolution by default (~$0.04/image, ~3–6 min total via parallel kie calls; set LIFESTYLE_RESOLUTION=2K to upgrade), saved to Supabase as ProductImage rows with imageType="lifestyle". ALWAYS asks the user "single-unit or multi-unit?" before invoking the script — single-unit shows one product per image; multi-unit shows the same variant repeated N times in the frame (never mixes variants within a single image). Invoke when the user says "make lifestyle images" / "generate lifestyles" / "lifestyle shots" / "in-context images" / "/lifestyle-image-creator", OR pastes a /review/<productId> URL and asks for lifestyle / scene / room images, OR just generated heroes and says "now do lifestyles". Mode A (local DB product) only for now. Requires heroes to exist on the product first — if none, suggest running /hero-image-creator first.
---

# Lifestyle Image Creator

## What this skill does

For a product already in our DB (`/review/<productId>`):

- Loads the product + visible variants + their `featuredImage` (preferring `imageType="hero"`).
- Builds a list of **unique hero files** across the visible variants. The 6 generated images cycle through these so different variants appear throughout (the user explicitly wants variety).
- Generates **6 lifestyle photographs** via kie.ai's Nano Banana Pro:
  - Each at **1:1 aspect ratio**, default **1K resolution** (faster + cheaper; set `LIFESTYLE_RESOLUTION=2K` env var for higher detail).
  - Each gets a different **camera angle** (eye-level wide, low three-quarter, top-down flat-lay, over-the-shoulder, ambient room, close-up detail).
  - Each gets a different **variant's hero** as reference (round-robin).
- Uploads each output to Supabase Storage at `lifestyle/{productId}/{slot}-{angle-slug}.png`.
- Persists each as a `ProductImage` row with `imageType="lifestyle"`, `variantId=null`, position appended to the gallery. Visible immediately in the review page's Images section.

## Scope

- Lifestyles only. NOT heroes (use `/hero-image-creator` for those). NOT description rewriting.
- Mode A (local DB product) only. Live Shopify products are not supported in v1.
- Same variant repeated within one image (multi-unit mode) is allowed. Two different variants within the same image is NOT allowed — that breaks the "absolute product fidelity" rule in the prompt.

## When to invoke

Invoke whenever the user:
- Says "make lifestyle images" / "generate lifestyle shots" / "lifestyle photos" / "in-context images" / "scene images".
- Says "/lifestyle-image-creator" or invokes by name.
- Pastes a review URL and asks for lifestyle / room / scene images.
- Just used /hero-image-creator and follows up with "now do lifestyles".

**Do NOT invoke**:
- If the product has zero heroes — suggest running /hero-image-creator first.
- For Shopify-side products. v1 only supports local-DB products on the review page.
- Pre-emptively as part of a fresh scrape. This skill is post-hero, manual.

## Required gating question (ALWAYS ASK)

Before running the script, **always ask the user**:

> "Should this be single-unit (one product per image) or multi-unit (multiple copies of the same variant per image)?
>
> Multi-unit is right when the product is usually sold/displayed in pairs/sets (e.g. matched lamps on bedside tables, candles on a mantle). Single-unit is right when the product is sold individually (e.g. one statement lamp, one wall clock).
>
> If multi-unit, how many copies — 2, 3, or more?"

Wait for the answer. Then invoke the script with either no flag (single-unit) or `--multi-unit N`.

**Do NOT decide single vs multi yourself.** The user explicitly wants to make this call.

## Model + API

- **Model identifier**: `nano-banana-pro` (verified against kie.ai's model catalog).
- **Endpoint**: `POST https://api.kie.ai/api/v1/jobs/createTask`
- **Auth**: `Authorization: Bearer $KIE_API_KEY`
- **Body shape** (note: Nano Banana Pro uses `image_input` plural + `resolution`/`output_format` — NOT `image_urls` like Seedream):
  ```json
  {
    "model": "nano-banana-pro",
    "input": {
      "prompt": "<full prompt baked into script + angle + unit clauses>",
      "image_input": ["<one hero public URL>"],
      "aspect_ratio": "1:1",
      "resolution": "1K",
      "output_format": "png"
    }
  }
  ```
- **Poll**: `GET /api/v1/jobs/recordInfo?taskId=...` every 5s until `state` is `success` or `fail`. 8-min timeout (Nano Banana Pro at 2K can take 5–8 min).
- **Cost**: ~$0.04 per image at 1K (default) × 6 = **~$0.24 per product**. At 2K: ~$0.09 × 6 = ~$0.54. Wall time: **~3–6 min** (6 slots run concurrently via Promise.allSettled).

## The prompt (baked verbatim into the script)

The full lifestyle prompt (provided by user) lives as the `LIFESTYLE_PROMPT` constant in `scripts/_lifestyle-image-creator.ts`. Each generation appends:

- `CAMERA ANGLE FOR THIS IMAGE: <one of 6 angle directives>`
- `UNIT COUNT FOR THIS IMAGE: <single-unit clause OR multi-unit clause with N>`

The 6 angle directives are baked in the script. To change a directive or the master prompt, edit the script file directly.

## Workflow

1. Detect productId (cuid or `/review/<id>` URL — same parsing as hero-image-creator).
2. Ask the user the gating question above.
3. Run `npx tsx scripts/_lifestyle-image-creator.ts <productId> [--multi-unit N]`.
4. Monitor via Bash. Script prints per-image status + cost.
5. Report:
   - Number of lifestyles generated / failed.
   - Total cost.
   - Review URL so the user can see the new gallery entries.

## Failure modes

- **No heroes on product**: exit cleanly with "Run /hero-image-creator first — this product has no hero images to use as reference."
- **kie.ai content-filter rejection**: log + skip that image, continue with the rest.
- **kie 5xx / network**: one retry per image after 15s, then skip.
- **All 6 fail**: report total and tell the user to check `KIE_API_KEY` / model identifier.

## Dry-run

The script accepts `--dry-run` which builds and prints the 6 prompts WITHOUT calling kie or spending credits. Useful for verifying angle directives + unit-clause shape after edits.

## Helper script

`scripts/_lifestyle-image-creator.ts` (project-local). Edit it to change the prompt, angle directives, model identifier, or output bucket path.
