---
name: lifestyle-scene-designer
description: Design 6 lifestyle / in-context scene prompts for a lighting product by reasoning like an interior/exterior designer — viewing the product's actual gallery images, classifying it indoor/outdoor/both, and authoring fresh, varied, medium-density scene prompts tuned to how the product really looks. Writes the prompts to scene-overrides/<productId>.json, which the existing _lifestyle-image-creator.ts then uses (instead of the curated scene library) to drive Higgsfield and upload to the review page. Invoke when the user pastes a product URL or /review/<productId> id and asks to "design scene prompts" / "make lifestyle prompts" / "create the 6 prompts" / "design scenes for this product" / "do lifestyle prompts for this", or says "/lifestyle-scene-designer". This is the project-standard way scene prompts are made; the old keyword-classified scene-library matcher remains only as an automatic fallback when no override file exists.
---

# Lifestyle Scene Designer

> **Analyse the product first — this skill is the LIGHTING branch.** For a
> **non-lighting / general** product (jewellery box, decor, furniture,
> kitchenware, watch, …) do NOT use this lighting-designer flow. Instead follow
> the **general process** in the `lifestyle-image-creator` skill (and the
> [general-lifestyle-process] memory): per-product obvious-only functionality
> analysis → one-time per-category research checklist saved to a memory recipe →
> hand-author 6–8 unique `scene-overrides/<id>.json` scenes guided by that
> recipe. The override file format + downstream generation are identical; only
> the design reasoning differs (lighting placement/archetypes vs. general
> editorial product-in-context).

Design lifestyle scene prompts for one lighting product, the way an interior /
exterior designer would — by looking at the real product and reasoning about
where it belongs, what surrounds it, and what palette suits it. (Output count
is flexible: the override path now generates the scenes you author, clamped 6–8.)

The output is a `scene-overrides/<productId>.json` file. The existing
`scripts/_lifestyle-image-creator.ts` automatically picks it up and uses these
prompts instead of the curated-library match — everything downstream (Higgsfield
generation, Supabase upload, review-page display) is unchanged.

## When to use

The user pastes a product URL (`/review/<productId>`) or a product id and asks
for scene / lifestyle prompts, or says `/lifestyle-scene-designer`. This is the
design half only — image generation is done afterwards by `lifestyle-image-creator`.

## Procedure

The whole design step is one script. It does not run inside this conversation —
it makes its own isolated Claude API call so the product images are resized and
sent once, never accumulating in the chat transcript (which is what tripped the
Claude vision API's per-image megapixel limit and the "many-image request"
2000px dimension limit in the old in-chat flow).

### 1. Run the scene designer

```
npx tsx scripts/_lifestyle-scene-design.ts <productIdOrUrl>
```

This script:

1. Downloads the product's gallery + per-variant reference images and resizes
   every one to a bounded JPEG (≤1024px, ≈1 MP) — written to
   `scene-overrides/_prep/<productId>/` for inspection.
2. Makes ONE Claude API call (`claude-opus-4-7`): the design rule set
   (`LIGHTING-LIFESTYLE-PLAYBOOK.md` + the dazuma-aesthetic style bible +
   `accent-bank.md`) as a cached system prompt; the product context, the
   `scene-ledger.md`, and the resized images as the user message; six scenes
   returned as structured JSON. It classifies the product indoor / outdoor /
   both and designs six varied scenes following the playbook.
3. Writes `scene-overrides/<productId>.json` — the same file the old flow
   produced, picked up verbatim by `_lifestyle-image-creator.ts`.
4. Appends the six new scenes to `scene-ledger.md`.

Add `--dry-run` to download + resize the images and assemble the prompt without
calling the API or writing the override — useful for inspecting the inputs.

### 2. Review the output

`Read` the written `scene-overrides/<productId>.json` and sanity-check it:
six scenes, `variantSlot` 1..6 in order, classification matches the product,
prompts read well and are varied. If anything is off, re-run the script (it
overwrites) or edit the JSON directly.

### 3. Hand off to image generation

Tell the user the override is ready, then generate the images by invoking the
`lifestyle-image-creator` skill, or directly:

```
npx tsx scripts/_lifestyle-image-creator.ts <productId> --headed
```

It will log `scene-designer: using Claude override …` and drive Higgsfield with
these prompts, uploading the results to the review page exactly as usual.

## Notes

- The script auto-loads `.env.local` for `ANTHROPIC_API_KEY` (the scene
  designer) and the Supabase credentials (image download).
- If `scene-overrides/<productId>.json` is absent or malformed, the creator
  silently falls back to the curated scene library — nothing breaks.
- `scene-overrides/<productId>.json` files are version-controlled; the
  `scene-overrides/_prep/` artifacts are disposable and git-ignored. The script
  wipes and re-downloads the prep folder on every run, so stale oversized
  images can never linger.
- `scripts/_lifestyle-scene-prep.ts` is the old download-only helper from the
  in-chat flow. `_lifestyle-scene-design.ts` supersedes it; keep `_prep` only
  for manual inspection.
