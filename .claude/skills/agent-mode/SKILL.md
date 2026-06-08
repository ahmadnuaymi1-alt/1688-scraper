---
name: agent-mode
description: Run the full 1688 → Shopify-ready pipeline end-to-end on a single 1688 URL ("agent mode"). Scrapes, audits, fixes variants (Vision-rename opaque codes, axis-split when justified, dedup, unhide pack-axis false positives, set productType), cross-checks dimensions, generates heroes via the hero-image-creator skill, AUTHORS scene-overrides JSON from the matching cornucopia BEFORE invoking the lifestyle-image-creator skill (mandatory for non-lighting products — the script otherwise misclassifies as "pendant"), runs lifestyles, DELETES original 1688 images (honors `ProductImage.keep=true` starred images), then reapplies rules and delivers a `/review/<id>` page that's ready to upload. Invoke whenever the user says "/agent-mode", "use agent mode on this URL", "do agent mode A-to-Z on this", "run the full agent on this product", "scrape this through agent mode", or pastes one or more 1688 URLs and asks for end-to-end handling. Claude drives the JUDGMENT steps (variant intelligence + scene-overrides authoring) and runs the chained `scripts/agent-mode.ts` orchestrator for the mechanical pipeline — `--from-url` does scrape→Phase2→productType, then `<productId>` chains heroes→{lifestyles ∥ pricing ∥ non-image rules ∥ delete-originals}→image-rule→gallery-preset in ONE process (proven ~3:44 on a small product vs ~12 min step-by-step). For multi-product batches, set `HIGGSFIELD_MAX_INFLIGHT=8` so the global in-flight gate keeps total Higgsfield generations ≤8. All additive / agent-mode-only; default scraper behavior is unchanged.
---

# Agent Mode (1688 → ready-to-upload)

## What this skill does

Walks one 1688 URL all the way to a `/review/<id>` page that's ready for the user to click "Upload to Shopify." The mechanical pipeline is now a chained orchestrator (`scripts/agent-mode.ts`); Claude still drives the judgment steps in between. The recipe below encodes the lessons from the 2026-06-07 Phase 0b dogfood on `707904146055`, the user's follow-up feedback, and the speed work that turned ~12 min of step-by-step hand-offs into a ~3:44 single-process run.

**Scope guard (CRITICAL):** all agent-mode behavior is ADDITIVE. `scripts/agent-mode.ts` and `scripts/_hf-inflight-gate.ts` are new; the in-flight gate is no-op unless `HIGGSFIELD_MAX_INFLIGHT` is set. Do NOT change the default behavior of `_scrape-1688-url.ts`, `_hero-image-creator.ts`, `_lifestyle-image-creator.ts`, `scraper.service.ts`, `rule.service.ts`, `pricing.service.ts`. The orchestrator DRIVES those unchanged.

## How it runs (the two orchestrator calls + Claude judgment in between)

```
1. FRONT (mechanical):   npx tsx scripts/agent-mode.ts --from-url "<URL>"
        → Phase-1 scrape → Phase-2 audit → set productType → prints "HANDOFF productId=<id>"

2. JUDGMENT (Claude — steps 3,4,6 below; the riskiest decisions stay manual):
        → variant intelligence (Vision rename / axis-split / dedup / unhide pack-axis
          false-positives / remove-all-variants for single-SKU / set productType if classifier was unsure)
        → dimension cross-check
        → author scene-overrides/<id>.json from the matching cornucopia (NON-LIGHTING only)
        → optional: pre-write hero-overrides/<id>.json if you already expect a defect

3. TAIL (mechanical):    npx tsx scripts/agent-mode.ts <productId> [--concurrency 6]
        → STAGE A heroes (built-in Gemini source-match auto-regen runs inside)
        → STAGE B in parallel: lifestyles+closeup ∥ pricing(recalc+apply, retry)→[description,title,tags,seo] ∥ delete-originals
        → STAGE C image rule  → STAGE C.5 gallery preset  → STAGE D inspect + flags + /review URL
```

Flags the tail prints (e.g. productType null, pricing fell back to launch, a hero/lifestyle slot failed) are for your review — surface them to the user, don't bury them. Re-running the tail is safe: heroes skip existing, lifestyles skip when ≥6 already exist (`--force-lifestyles` to override), delete/rules are deterministic.

The detailed Step 1–10 descriptions below document WHAT each call does and the judgment steps in full — read them, but you no longer invoke steps 1/2/5/7/8/8.5/9/9.5/10 by hand; the orchestrator does.

## When to invoke

Invoke this skill whenever the user:
- Says "/agent-mode", "use agent mode on this URL", "do agent mode A-to-Z", "run the full agent on this product", "scrape this through agent mode".
- Pastes a `https://detail.1688.com/offer/<id>.html` URL and asks for end-to-end handling or "everything from step A to Z."
- Asks for "the full pipeline" / "the whole flow" / "do everything for this product" on a 1688 URL.

Do NOT invoke for partial requests like "just generate heroes" — that's the hero-image-creator skill. Agent mode means the entire chain.

## Inputs the skill needs

A single 1688 product URL. Nothing else. The skill handles category detection, variant decisions, scene-overrides authoring, and delete-originals timing.

## Pre-flight: read these first

Before starting, read in this order to ground yourself in the user's invariants:
1. `memory/MEMORY.md` (auto-loaded) — note the `agent-mode-design-intent.md` entry; its principles override defaults.
2. `memory/agent-mode-design-intent.md` — agent-mode architectural commitments (autonomous virtual-assistant intent, hero correction is regen-from-source not edit-pass, "easiest for customer to understand" variant anchor, agent-mode-only scope guard).
3. `memory/agent-judgment/` directory — `global.md` + the matching `category-<slug>.md` for the product (loaded after step 3 below confirms productType).
4. `memory/lifestyle-cat-<slug>.md` (cornucopia for the product's category) — required for step 7 scene-overrides authoring.

If the product is in a NEW category with no cornucopia, follow the lifestyle-image-creator skill's general process to do the one-time research and write the new `memory/lifestyle-cat-<slug>.md` BEFORE step 7.

## Pipeline

### Step 0 — Re-scrape cleanup (only if re-running on a previously-failed product)

If you're re-scraping a 1688 URL because an earlier scrape failed mid-run, **first delete the old failed product** so it doesn't clutter the imports UI. Two paths:
- DELETE `/api/products/<oldProductId>` (cascades to variants + images via Prisma schema)
- OR: delete the ScrapeJob via the jobs API (`DELETE /api/jobs/<jobId>`) which cleans up the entire job + product chain.

Skip this step for fresh URLs that aren't a re-run.

### Step 1 — Phase 1 scrape (Bright Data → DB)

```bash
npx tsx scripts/_scrape-1688-url.ts "<URL>"
```

Wait for completion. Captures productId from the FINAL output. Status transitions to `applying_rules`. **CRITICAL:** this script does NOT auto-trigger Phase 2 audit despite what the JobLog says — you must invoke it explicitly in step 2.

### Step 2 — Phase 2 audit (explicit invocation)

Write a one-off script that imports and calls `handleRulesJob(jobId)` from `src/services/scraper.service.ts`. Pattern: `scripts/_finish-phase2-<jobId>.ts` (see `scripts/_finish-phase2.ts` for the canonical shape). This runs:
- variant-name-cleanup
- variant-double-checker
- variant-image-rederive (re-derives `Variant.featuredImageId` based on finish+size matching)
- gallery-preset-service + description-enrichment-service
- post-scrape-audit (the 10 checks)

Wait for `status="ready"`. Inspect the JobLog and post-scrape-audit summary.

### Step 3 — Variant intelligence pass (Vision-driven)

Inspect the product state. Decide the structure that's "easiest for the customer to understand."

**Single-variant rule (new 2026-06-07):** if the product has exactly 1 visible variant (regardless of how many supplier rows came in), the customer-facing pattern is "no variants — single SKU." Call `POST /api/products/<productId>/remove-all-variants` (or replicate the logic) to drop the variant axis entirely. After that, the gallery's FIRST image becomes the hero on the storefront, so during Step 10 (preset order) the orchestrator must ensure the right hero image sits at position 0. The remove-all-variants endpoint preserves one Variant row internally so price/SKU/weight have a home, but the UI shows no variant picker. **Do not skip** — a single-row variant table with one meaningless picker is a customer-confusing pattern.

Check for these failure modes (all confirmed by dogfood):
- **Opaque numeric variants (`1, 2, 3, ..., N`).** Phase 2 sometimes doesn't fix these. Run Gemini Vision on each variant's featured image to derive attributes (case color, dial color, strap, bezel, etc. for watches; analogous attributes for other categories). Pattern: `scripts/_vision-rename-watch-variants.ts` (was written during the 2026-06-07 dogfood; adapt for the category).
- **Pack-axis detector false-positive.** Phase 2's Check 3 may hide N-1 of N visually-distinct variants when option values look numeric. After Vision rename, unhide everything that's genuinely distinct.
- **Multi-dimensional variants.** If Vision attributes vary on TWO independent axes (e.g. dial color × strap material for watches), restructure into a 2-axis product: update `Product.optionNames = ["Axis1", "Axis2"]` + per-variant `option1` + `option2`. User anchor: "easiest for the customer to understand."
- **True duplicates.** If multiple variants Vision-classify to identical option values, keep the lowest-position one and hide the rest (`isHidden=true`).
- **Packaging-accessory variants.** Watch out for variants whose Vision verdict says "presentation box / gift bag / shopping bag" — these are supplier upgrade upsells, not real variants. Hide them.
- **`Product.productType` is null.** Phase 2 doesn't set this. Set it manually (`"watch"`, `"chandelier"`, `"pendant"`, `"wall-sconce"`, `"jewelry-box"`, etc.) so future tooling and the scoped judgment classifier can route correctly.

Sequential DB writes (connection_limit=1).

### Step 4 — Description / dimension cross-check

Read the product's `descriptionHtml` and gallery images. If the gallery has measurement annotations (most watches show 43mm case / 12mm thickness illustrations; lighting shows fixture dimensions), confirm those numbers appear in the description's spec table in inches (memory: `no-image-optimizer-on-gallery`, `post-scrape-audit-preferences` → "inches not cm"). If you find a mismatch, fix the description via rule reapply or note for the user.

Per `rewrite-rule-per-style-preservation` memory: never collapse `Dimensions (Yunshi Small)` to generic `(Small)` — preserve per-style/per-variant labels when present.

### Step 5 — Heroes (via hero-image-creator skill)

Invoke the existing `hero-image-creator` skill with the productId. It handles category routing (HERO_PROMPT_WATCH for watches, HERO_PROMPT for lighting, HERO_PROMPT_GENERAL for everything else). Default concurrency 4.

After completion, run a Vision QA pass against the loaded `memory/agent-judgment/category-<slug>.md` rubric. Pattern: `scripts/_critic-prototype-watches.ts` (from dogfood) generalized to read the category file. Look for: no tags / no props / upright (watches) / bulb-state correct (lighting) / no plastic stands / etc.

For any hero flagged as `minor` or `major`:
- Write a per-product `hero-overrides/<id>.json` with `heroPromptExtraNotes` targeting the specific defect.
- Use the revert pattern from `scripts/_regen-watch-strip-tags.ts`: re-point `Variant.featuredImageId` → 1688 source, delete the bad hero, re-run `_hero-image-creator.ts <productId>` (idempotency skips the others).
- Budget: max 2 attempts per variant, max 15 per product. After exhaustion, leave the flagged hero as-is and report it to the user.

### Step 6 — Author scene-overrides JSON from category cornucopia (NON-LIGHTING ONLY)

**This step is mandatory and existed before agent mode — the existing lifestyle skill documents it, but the script does NOT auto-route based on `isWatchProduct()`. Without an override file, the scene-designer misclassifies non-lighting products as "pendant" and generates wrong-category scenes (foyer, dining_room, etc.).**

For non-lighting products:
1. Confirm `memory/lifestyle-cat-<slug>.md` exists for the product's category (watches / pendant-necklace / bolo-tie / jewellery-box / etc.). If not, run the lifestyle-image-creator skill's general process first to research + write a new cornucopia (one-time per category).
2. Write `scene-overrides/<productId>.json` following the format of recent batches (e.g. `scene-overrides/cmpzixtaz00aow2hsqq59fqqx.json` for watches). Each scene includes: `slug`, `mode` ("minimalist" or "homey"), `variantSlot`, `strategy`, `anchor`, `prompt` (150-200 words, reference-image-only product anchor — NO embedded product description per `override-no-inline-product-desc` memory).
3. Anti-recycling rule (from `lifestyle-cat-watches.md` and similar): pick environments from the cornucopia menu that differ from the previous product's mix by ≥3 entries. Hit the variation axes (time-of-day, framing, palette, prop density, mood) per the cornucopia's instructions.

For lighting products: skip this step. The existing lifestyle script's lighting framework + the dazuma-aesthetic skill drive scene selection correctly.

### Step 7 — Lifestyles (via lifestyle-image-creator skill)

Invoke the existing `lifestyle-image-creator` skill with the productId. Default single-unit (`no-multi-unit-by-default` memory). For non-lighting it picks up the override file written in step 6.

After completion: 6 lifestyles + 1 closeup attached as ProductImage rows.

### Step 8 — Delete originals (CRITICAL — runs BEFORE rule reapply)

User context: originals usually have Chinese text or watermarks. User always manually triggers this before uploading. Starred originals (`ProductImage.keep=true`) are preserved — the user occasionally stars an exceptionally clean source lifestyle they want to keep.

Call the existing endpoint:
```
POST /api/products/<productId>/delete-originals
```
Or for headless use, replicate its logic: `prisma.productImage.deleteMany({ where: { productId, imageType: null, keep: false /* + host endsWith .alicdn.com */ } })`. Storage-side cleanup is best-effort via Supabase; DB delete is authoritative.

**DO NOT auto-star anything.** Only the user stars. The agent never sets `keep=true` automatically.

Response: `{ deleted, kept }`. Log both in the final status message.

### Step 8.5 — AI-suggested pricing (runs AFTER delete-originals, BEFORE rule reapply)

Memory invariants for this step:
- ALWAYS round nearest $4/$9, NEVER set `compareAtPrice` (code enforces this regardless of input).
- Tiered prices use `anchor × multiplier`; no size double-count.
- Clamp every variant up to at-least-2x landed cost floor.
- DB scripts must run SEQUENTIAL (shared prisma pool = `connection_limit=1`).
- See `memory/pricing-methodology.md` + `memory/ai-suggested-price-rounding-no-compareat.md`.

Two-call sequence:
1. `POST /api/products/<productId>/recalculate-pricing` with empty body → runs Claude AI, generates pricing ladder + recommended tier, persists rationale to `Product.pricingNotes` (JSON).
2. `POST /api/products/<productId>/recalculate-pricing` with `{ "tierOverride": "<recommended-tier-from-rationale>" }` → applies tier to all variants.

For headless/CLI use, call the service functions directly:

```ts
import { recalculatePricing, applyPricingToVariants } from "../src/services/pricing.service";
import { DEFAULT_SCRAPE_OPTIONS } from "../src/types/scrape-options";

await recalculatePricing(productId, DEFAULT_SCRAPE_OPTIONS);

// IMPORTANT: the recommended tier label is at pricingNotes.recommended.label,
// NOT pricingNotes.recommendedTier (correction 2026-06-07 — earlier skill rev
// had it wrong; subagents had to fix it inline). Always parse:
const prodRow = await prisma.product.findUnique({ where: { id: productId }, select: { pricingNotes: true } });
const notes = JSON.parse(prodRow.pricingNotes);
const recommendedTier = notes?.recommended?.label ?? "launch";

await applyPricingToVariants(productId, recommendedTier, DEFAULT_SCRAPE_OPTIONS);
```

`recalculatePricing` is OCCASIONALLY flaky — the Claude pricing model sometimes returns conversational preamble instead of JSON ("Claude response missing valid ladder"). Retry the call once or twice on this specific failure; it usually succeeds on the next attempt.

After this step, each visible `Variant.price` is finalized, `Variant.compareAtPrice` is null, and `Product.pricingNotes` has the full rationale. The description rule (Step 9) sees these finalized prices when it regenerates the description tables.

### Step 9 — Reapply rules (image rule now operates on clean gallery)

POST `/api/products/<productId>/reapply-rules` with:
```json
{ "categories": ["description", "image", "title", "tags", "seo"] }
```

Or call `reapplyRules(productId, ["description", "image", "title", "tags", "seo"])` from `src/services/rule.service.ts`.

Notes for the description rule:
- Reconcile the *visible* variant count (the dogfood revealed metaDesc + tags still said "23 colors" when 18 were visible — feed the live count if the rule supports it, otherwise note for the user to fix manually).
- Tags rule should preserve the source 1688 URL — the user has confirmed this is intentional (`tags-include-1688-url-intentional` per the design-intent memory). Do NOT strip.

### Step 9.5 — Apply gallery preset order (NEW, runs after rule reapply)

This step orders the gallery to the user's canonical Shopify-upload pattern. Always run as the FINAL data step before delivery.

Endpoint: `POST /api/products/<productId>/apply-gallery-preset` (route at `src/app/api/products/[id]/apply-gallery-preset/route.ts`). For headless use, call `applyGalleryPreset(productId)` from `src/services/gallery-preset.service.ts` directly.

The preset orders images as:
1. Lead variant's featured image (first row of the variant table = the customer-facing hero)
2. All lifestyle images (in current position order)
3. All starred (`keep=true`) images
4. All user-uploaded images
5. Remaining variants' hero images (in variant-row order)
6. Everything else (sources/swatches/closeups not already placed)

**For single-SKU products** (after Step 3's remove-all-variants), the kept variant's `featuredImageId` STILL drives position 0 — so the hero you want at the top of the storefront gallery must be that variant's featured image. If it isn't (e.g., the kept variant has no featuredImageId and the gallery's first image is a leftover source), set the right ProductImage as that variant's `featuredImageId` before calling apply-preset.

### Step 10 — Final sanity check + delivery

Run a quick inspect:
- Visible variants count matches what's mentioned in description / meta / tags.
- All visible variants have heroes attached.
- 6 lifestyles + 1 closeup present.
- No `.alicdn.com` ProductImage rows survived (except starred).
- Spec table dimensions present in inches.

Deliver the final message:
```
Ready: /review/<productId>
N visible variants, K rules applied, M corrections needed (list them), X originals deleted / Y starred.
```

If any items need user attention (failed hero critic after budget, ambiguous variant decision, dimension mismatch), list them clearly in the closing message — don't bury them.

## Batch mode (running N URLs concurrently)

The Higgsfield ceiling is **8 in-flight generations TOTAL** (hard limit). Do NOT hand-tune per-product concurrency to respect it — that was the old (wrong) advice (it told 6 products to run at concurrency 2 = 12 in-flight, which OVERSHOOTS 8 and triggers throttling/credit auto-swap). Instead:

- **Set `HIGGSFIELD_MAX_INFLIGHT=8` in the environment**, then launch every product's `agent-mode.ts <productId>` TAIL in parallel at the default concurrency 6. The global file-token gate (`scripts/_hf-inflight-gate.ts`, wired into `higgsfieldGenerate` + the closeup script) guarantees total in-flight image generations never exceed 8 across all processes, while keeping all 8 slots full for maximum throughput. Each process can ask for up to 6; the gate arbitrates globally.
- **Run the FRONTs (`--from-url`) staggered** (a few seconds apart) to avoid simultaneous Bright Data 429s — Phase-1 scrape is a separate limit from the image ceiling. Do the per-product variant intelligence + scene-overrides (judgment) between each product's FRONT and TAIL.
- **The throughput floor is image-count-bound:** total heroes+lifestyles+closeups ÷ 8 slots × ~60s/gen. Trimming heavy products' variant lists (variant-curation) before imaging is the only quality-preserving way to go faster — concurrency is fixed.
- **Track wall-clock timing.** `date -u +"%Y-%m-%dT%H:%M:%SZ"` at batch start and at the last TAIL's completion; report per-product + total.
- **Anti-recycling for scene-overrides** still applies — pick environments that differ from recent same-category products by ≥3 entries. Mild within-batch duplication is acceptable (the rule's intent is across-time uniqueness).
- **Manual gate reset** if a run crashes and slots seem stuck: delete `%TEMP%\hf-inflight-gate` (stale tokens older than 8 min self-reap anyway).

## Failure modes specific to agent mode

- **Supabase pooler intermittently times out** (`aws-1-eu-west-1.pooler.supabase.com:6543`). When it happens, the DB call returns `ETIMEDOUT`. Wait and retry — outages typically resolve in 2-3 minutes. Pattern: a one-shot `node -e` TCP probe loop with `until` semantics until reconnection.
- **Variant-name-cleanup didn't run.** Confirmed in dogfood the audit's Phase 2 cleanup can silently skip the opaque-rename step. After Phase 2, if variants are still `1, 2, 3`, drive the Vision rename yourself (step 3).
- **Hero override doesn't fix on the first retry.** Confirmed in dogfood that a single round of explicit "no plastic stand" prompting can still leak the prop. Use the budget (max 2 per variant) and escalate to the user if both attempts fail.
- **Wrong-category lifestyles.** If you forgot step 6 (scene-overrides authoring), the script will run the lighting framework and produce foyer/dining-room/bedroom scenes for non-lighting products. Catch this early — delete the wrong ProductImage rows (`imageType IN ("lifestyle", "lifestyle-closeup", "closeup")`), write the overrides, re-run the lifestyle script.

## Teaching loop

When the user corrects something during a run:
1. Infer scope from the conversation + the product currently being discussed (`category:<slug>`, occasionally `product:<id>`).
2. If scope is ambiguous, ask once (e.g., "watches only or all jewelry?").
3. Append the new rule to `memory/agent-judgment/<scope>.md` with the structured header (`Rule`, `Scope`, `Applies to`, `Generator-delta`, `Why`).
4. For the first ~5 corrections per session, show the proposed scope before saving. After that, save quietly unless ambiguous.

## Critical files

**Use (do not duplicate):**
- `scripts/_scrape-1688-url.ts` — Phase 1 scrape entry
- `src/services/scraper.service.ts:handleRulesJob` — Phase 2 audit (invoke explicitly)
- `scripts/_finish-phase2.ts` — canonical pattern for triggering Phase 2 on a stuck job
- `.claude/skills/hero-image-creator/SKILL.md` flow
- `.claude/skills/lifestyle-image-creator/SKILL.md` flow
- `.claude/skills/variant-double-checker/SKILL.md` flow
- `src/services/lifestyle-scene-designer.service.ts:loadOverride` — reads `scene-overrides/<id>.json` if present
- `src/app/api/products/[id]/delete-originals/route.ts` — the delete-originals endpoint
- `src/app/api/products/[id]/reapply-rules/route.ts` + `src/services/rule.service.ts:reapplyRules`
- `hero-overrides/` (per-product `heroPromptExtraNotes` overrides for the hero script)
- `scene-overrides/` (per-product Claude-authored lifestyle scenes)
- `memory/agent-mode-design-intent.md` (project memory — agent-mode principles)
- `memory/agent-judgment/global.md` + `memory/agent-judgment/category-<slug>.md` (rubric + generator deltas)
- `memory/lifestyle-cat-<slug>.md` (per-category cornucopia recipes)

**Pattern references (read for shape, don't necessarily run as-is):**
- `scripts/_vision-rename-watch-variants.ts` (variant intelligence Vision pass)
- `scripts/_apply-watch-variant-fix.ts` (axis-split + rename + dedup + unhide)
- `scripts/_regen-watch-strip-tags.ts` (hero revert+regen pattern)
- `scripts/_critic-prototype-watches.ts` (post-hero Vision QA against category rubric)
- `scene-overrides/cmpzixtaz00aow2hsqq59fqqx.json` (canonical watches scene-overrides format)

## Invocation summary

User says: "use agent mode on https://detail.1688.com/offer/<id>.html"

I do: steps 1-10 above, posting status as each completes, escalating any blocker to the user immediately rather than burying it in a final report.

End-of-run message includes: review URL, visible-variants count, rules applied count, items needing user attention, originals deleted / starred count. That's the deliverable.
