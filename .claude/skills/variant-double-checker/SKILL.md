---
name: variant-double-checker
description: Use Gemini Vision to double-check that a batch of scraped products' variant option values actually MATCH their images, and re-derive accurate, customer-friendly names for any that are wrong or opaque (bare numbers/letters/SKUs like "1, 2, 3" or "Design A"). Use whenever the user says "double check the variants", "check my variants are accurate", "make sure the variant colours/names match the images", "go through N products and verify the variants", "/variant-double-checker", or pastes one or more review/product URLs (or a count / a scrape day) and asks to verify or fix the variants. Also flags products whose values look two-dimensional (e.g. case-colour + dial-colour) as candidates for splitting into extra option axes ("columns"). Read-only/dry-run by default; applies do-no-harm renames only on confirmation.
---

# Variant Double-Checker

Verify a batch of products' variant names against their **actual images** using
Gemini Vision, fix the inaccurate ones, and — where it helps — recommend
splitting a packed axis into extra columns.

## The one rule that matters: look, don't guess

When a variant comes with a **clear, correct** label (e.g. an obvious colour the
supplier got right), leave it. But the moment you have to **invent or correct** a
name — especially for **opaque labels** (`1, 2, 3 …`, single letters `A/B/C`,
`Design A`, supplier SKUs) — you must **look at the image with Gemini Vision and
name it from what's actually shown**. Never name an opaque variant from its
position, the supplier's order, or a guess. This is the whole point of the skill.

## How to run

The engine is `scripts/_variant-double-check.ts`. **Dry-run by default** — it
prints proposed changes and writes nothing until `--apply`.

```bash
# Pick the product set (one selector):
npx tsx scripts/_variant-double-check.ts --ids <id1>,<id2>     # specific products (review-URL ids ok)
npx tsx scripts/_variant-double-check.ts --latest 10            # latest N scraped
npx tsx scripts/_variant-double-check.ts --day 2026-06-04       # all products from a scrape day (UTC)
npx tsx scripts/_variant-double-check.ts --title "Table Lamp"   # title substring

# After spot-checking the proposal (see below), apply:
npx tsx scripts/_variant-double-check.ts --ids <id1>,<id2> --apply
```

The user usually says how many / which products ("go through my latest 10", "these
3 URLs", "today's watches") — translate that into the right selector. Review URLs
like `http://localhost:3000/review/<id>` → pass the `<id>` to `--ids`.

## What each run does

1. **Resolve** the product set from the selector.
2. For each product, send **all visible variant images in ONE Gemini call** (so it
   names them distinctly, relative to each other) with the current labels. Gemini
   returns, per variant: the actual appearance, whether the current label matches,
   and a proposed accurate name.
3. A variant is queued for a rename when its label is a **mismatch** OR an
   **opaque code** (`isOpaque()` in the script — bare numbers, single letters not
   S/M/L, `Design A`-style, SKUs). Clear-and-correct labels are left untouched
   (do-no-harm).
4. Print per-product: `✓ all accurate` or the `from → to` renames.
5. Flag **axis-split candidates** — products where most proposed names are
   two-part (`Gold / Blue Dial`) → that axis may read better as two columns.

## Verify, don't trust the model blindly

Before `--apply`, **spot-check a few of the proposed renames against the real
images yourself** (download 3-4 and Read them). Gemini is strong at colour/visual
ID but can over-flag (e.g. it once wanted "Silver & White" for a correctly-labelled
"Silver" watch). Confirm the changes are genuine, then apply. Report what you
verified — never claim accuracy you didn't check. (See `dont-overclaim-verify`.)

## Extra columns (axis splitting)

When the audit flags a product as two-dimensional — e.g. a watch where every
variant is `<case metal> / <dial colour>` — splitting the single `Color` axis into
two clean axes (`Finish` × `Dial`) often makes the picker far clearer. This is a
**bigger, riskier change** (it restructures the variant grid and can create
unavailable combos on sparse sets), so:
- Only split when the values form a near-complete grid and every sub-dimension is
  a real customer choice.
- Reuse the variant-curation house style for the axis names + values (Title Case,
  brevity-for-clarity). See the `variant-curation` skill.
- Show the proposed two-axis layout and confirm before writing.

## Cost & rate limits

- One batched Gemini 2.5-Flash call per product ≈ **$0.002–0.01**.
- The **free Gemini tier rate-limits** at ~10–15 req/min — the script already
  spaces calls (4 s) and retries 429s, but for large batches expect it to throttle.
  For production-scale batches, use a paid Gemini key.

## Notes

- Reads `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.
- Only touches `Variant.option1` + `title` (the colour/style axis); never drops or
  hides variants. Pairs with `variant-curation` (naming style) and the always-on
  scrape-time name cleanup.
