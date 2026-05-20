---
name: lifestyle-image-creator
description: Generate 6 unique editorial lifestyle / in-context product photographs by driving higgsfield.ai's Nano Banana Pro flow through a stealthed Playwright browser. Each 6-batch is SPLIT 50/50 — 3 MINIMALIST scenes (gallery-presented hero, tight 25-35% framing, low density, drawn from a 10-brand archetype menu: Dazuma-vaulted, Visual-Comfort-moody, McGee-moody-library, Amber-warm-Cali, Schoolhouse-craft, Pierre-saturated-plaster, deVOL-English-country, Cedar&Moss-gallery, Pottery-Barn-lived-in, Japandi-Scandi-minimalist) and 3 HOMEY scenes (lived-in / layered / decorated, wider 15-25% framing, mid-density 3-5 objects per surface, drawn from a 7-archetype interior-designer menu: Caillier-PNW, Amber-warm-Cali-lived-in, Heuman-British-eclectic, Stoffer-Michigan-kitchen, Bartholomew-Southern-traditional, Sikes-blue-and-white, EyeSwoon-curated-artisan). Homey scenes ENFORCE the PRODUCT-COLOR-ECHO rule (the room repeats the product's metal finish + dominant textile color in 2+ other elements), pattern stacking 1+1+1 tied by a shared color, wood-tone mixing, textile layering, living plant matter, and a "just-here" cue. VARIANT ROTATION — if the product has multiple visible variants, the script cycles through the hero pool across the 6 slots (3 variants → slots 1,2,3,1,2,3; 6 variants → one each; 1 variant → all 6 share it). Each scene uses ONE distinct compatible archetype + ONE distinct camera angle from a 9-angle vocabulary + ONE distinct appropriate room for that lighting category. Universal anti-tropes: zero people / pets / portraits-of-people / alcohol / casual-electronics / food-prep / Chinese-characters. Output: 6 lifestyle PNGs saved to Supabase as ProductImage rows with imageType="lifestyle". ALWAYS asks "single-unit or multi-unit?" before invoking. Invoke when the user says "make lifestyle images" / "generate lifestyles" / "lifestyle shots" / "in-context images" / "/lifestyle-image-creator", OR pastes a /review/<productId> URL and asks for lifestyle / scene / room images, OR just generated heroes and says "now do lifestyles". Mode A (local DB product) only. Requires heroes to exist first — if none, suggest /hero-image-creator first.
---

# Lifestyle Image Creator (Higgsfield)

## What this skill does

Drives Higgsfield's web UI through a stealthed Playwright browser to generate 6 lifestyle images for one product. Each image:
- Uses a product variant as the reference, cycling through the hero pool (see variant rotation below)
- Gets a UNIQUE Claude-designed scene prompt produced by the five-step framework
- Is generated in parallel with the other 5 (one Higgsfield tab per scene)
- Lands in Supabase as a `ProductImage` row (`imageType="lifestyle"`, `variantId=null`)

### Variant rotation across the 6 slots

The script reads the product's visible variants and builds a hero pool (one entry per unique source image — sister variants sharing a swatch count as one). It then cycles through the pool across the 6 slots:

| Visible variants in pool | Slot assignment |
|---|---|
| 1 | all 6 slots use that one variant |
| 2 | slots 1,2,1,2,1,2 |
| 3 | slots 1,2,3,1,2,3 |
| 6 | one slot per variant |
| 4-5 or 7+ | round-robin |

So a product with 3 visible variants will see all 3 represented across the 6 lifestyle images. The cycling logic lives at [scripts/_lifestyle-image-creator.ts:272-279](../../../scripts/_lifestyle-image-creator.ts#L272).

### The five-step framework (run internally by Claude before every batch)

1. **Classify** the product's lighting category (table-lamp, floor-lamp, wall-sconce, chandelier, pendant, flush-mount, outdoor). Placement is non-negotiable and gates the appropriate-rooms list.
2. **Profile** — Claude writes an internal aesthetic profile: style era, material vocabulary, color temperature, formality, mood, scale, cultural reference.
3. **Compatibility** — each brand archetype (10 minimalist + 7 homey = 17 total) is marked COMPATIBLE or INCOMPATIBLE with the product profile. INCOMPATIBLE archetypes are never used — they produce visually wrong scenes (e.g. a serene Japanese paper lantern in a McGee charcoal-walnut library).
4. **Mode split** — every 6-batch is 3 MINIMALIST scenes (slots 0-2) + 3 HOMEY scenes (slots 3-5). Non-negotiable. The two modes have different rules for framing, density, accent color, patterns, textiles, art, and architecture — they're NOT mixed within a scene.
5. **Design 6 scenes** — each pulls ONE compatible archetype, ONE distinct camera angle from the 9-angle vocabulary (dead-front, slightly-low ¾ left/right, slightly-high looking-down, pure-profile L/R, hero-low worm's-eye, high ¾ over-the-shoulder, steep high-angle), ONE distinct appropriate room, ONE distinct accent palette.

### Minimalist-mode rules (scenes 1-3)

- **Archetype pool (10)**: dazuma-vaulted, visual-comfort-moody, mcgee-moody-library, amber-warm-cali, schoolhouse-craft, pierre-saturated-plaster, devol-english-country, cedar-moss-gallery, pottery-barn-lived-in, japandi-scandi-minimalist
- **Framing**: product fills 25-35% of frame. 35-50mm lens. Tight, hero-presented.
- **Density**: LOW — 1-3 objects per surface.
- **Accent**: ONE deliberate accent per scene.
- **Patterns**: max 1 pattern element per scene.
- **Textiles**: undisturbed. Folded throws, smooth bedding, plumped cushions.

### Homey-mode rules (scenes 4-6)

- **Archetype pool (7)**: caillier-pnw-painted-cabinetry, amber-warm-california-lived-in, heuman-british-joyful-eclectic, stoffer-michigan-family-warm-kitchen, bartholomew-southern-collected-traditional, sikes-blue-and-white-classic, eyeswoon-curated-artisan
- **Framing**: product fills 15-25% of frame — WIDER. 35mm lens. The room context is the subject as much as the product.
- **Density**: MID — 3-5 objects per surface (never 1-2 = gallery; never 7+ = cluttered).
- **THE PRODUCT-COLOR-ECHO RULE** (the single most important homey rule): the room must echo the product's TWO strongest colors (typically metal finish + dominant textile/shade color) in at least 2 OTHER elements each. A brass + cream-linen lamp → the room has brass picture-frames/pulls AND cream-linen curtains/pillows elsewhere.
- **Pattern recipe**: 1 large (rug OR wallpaper) + 1 medium (pillow or curtain) + 1 small (lampshade trim, piped edge), all tied by ONE shared color.
- **Wood-tone mixing**: ≥2 distinct wood tones per scene. Never monochrome wood.
- **Textile layering**: ≥3 layers per seating piece (upholstery + ≥2 distinct pillows + thrown throw). Beds: ≥3 pillows + coverlet folded back OR quilt rumpled.
- **Living plant matter required**: foraged-style branches in chunky earthenware, OR potted fig/citrus/herbs, OR gathered fresh-cut flowers (never florist-tight).
- **"Just-here" cue required**: open book face-down, stack of askew books, half-burned candle, basket with folded throw, cutting board against backsplash, copper kettle, dish towel over oven handle, rumpled bedding, or folded reading glasses on a tray.
- **Architectural homey-cue required**: built-in bookshelves with books slightly out of order, layered window treatments, wainscoting, exposed beams with patina, painted shiplap, brick floor, terracotta hex tile, cottage moulding, or arched doorway.
- **Saturated walls allowed**: sage, dusty blue, blush, butter yellow, petrol-on-cabinetry, wallpaper.

### Universal anti-tropes (enforced in every scene)

- NO humans, faces, hands, silhouettes, body parts
- NO pets, kids, toys, cribs, bunk beds
- NO portraits-of-people, family photos, figurative people-art (landscape oils, abstract, botanical prints, ink sketches OK)
- NO alcohol (wine, whisky, cocktails, decanters)
- NO casual electronics (phones, laptops, remotes, charging cables, eyeglasses)
- NO food in preparation (chopped veg, flour, plated meals — whole fruit in bowls OK)
- NO Chinese characters anywhere in frame
- NO outdated 2010s tropes (chevron flooring, all-gray-everything, edison-cage pendants)
- Tight framing: product fills 25-35% of frame, never a distant background prop
- The fixture is the only artificial light source in frame; warm 2700-3000K glow

### Each scene's prompt structure

A bracketed tag-block on line one + a 150-200 word descriptive paragraph:

```
[room: X | architecture: Y | accent: Z | styling: W | camera: ANGLE | influence: BRAND]
<150-200 word self-contained paragraph naming placement, architecture, accent,
styling props (1-3 max), camera angle in words, time of day + light direction,
and confirming the fixture is on at 2700K>
```

**Scope**: lifestyles only. No heroes, no description rewriting.

## When to invoke

Invoke when the user:
- Says "/lifestyle-image-creator", "make lifestyle images", "generate lifestyles", "lifestyle shots", "in-context images", "scene images", "room images".
- Pastes a review URL and asks for lifestyle / scene / room images.
- Just finished hero generation and says "now do lifestyles" or similar.

**Do NOT invoke**:
- If the product has zero heroes — suggest `/hero-image-creator` first. The script will hard-gate this anyway.

## ALWAYS ask before invoking: single-unit or multi-unit?

Higgsfield is good at compositing identical-variant repetition into one frame but BAD at mixing variants. Ask the user:

> Single-unit (one product per image) or multi-unit (N identical units of the same variant per image)?

If multi-unit, also ask N. Default is single-unit if they don't specify.

## Inputs the skill needs

A `productId` (cuid) or a review URL containing `/review/<productId>`. Auto-detected.

## Pipeline

- **Driver**: Playwright (`playwright-extra` + stealth) launching the user's real Chrome with the persistent `%TEMP%/scene/higgsfield-session` profile — the same one the hero generator uses. Login state carries across runs.
- **Higgsfield UI**: 2K resolution + 1:1 aspect ratio set as a one-time UI click before the prompt loop. Then 6 tabs open in parallel.
- **Reference attachment**: each tab uploads ONE reference image — the variant's hero PNG (downloaded from Supabase to a temp file). No positioning template (that was a hero-shot thing).
- **Scene prompts** are generated up-front by a single Claude call via `src/services/lifestyle-scene-designer.service.ts`. The system prompt is a tight ~80-line Dazuma rule set extracted from the dazuma-aesthetic skill. Returns 6 scenes as `{ slug, prompt, variantPosition }`.
- **Parallel coordination**: the wrapper's existing `claimedUrls` set prevents two tabs from claiming the same generated-image URL.
- **Auto-retry**: on Higgsfield's "Failed — Credits refunded" widget, the wrapper auto-clicks Retry up to 2 times per slot. Only after all retries fail is the slot dropped (the other 5 still attach).

## Workflow

When invoked:

1. **Pre-flight** — kill any stale Higgsfield Chrome holding the profile lock:
   ```ps1
   Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
     Where-Object { $_.CommandLine -like "*higgsfield-session*" } |
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```
2. **Confirm single-unit vs multi-unit** with the user (see above).
3. **Run the script**:
   ```bash
   npx tsx scripts/_lifestyle-image-creator.ts <reviewURL> --headed
   # or multi-unit:
   npx tsx scripts/_lifestyle-image-creator.ts <reviewURL> --multi-unit 3 --headed
   # or dry-run (no Higgsfield calls — just prints designed scenes):
   npx tsx scripts/_lifestyle-image-creator.ts <reviewURL> --dry-run
   ```
   `--headed` shows the browser so the user can solve any rare security check; `--keep-open` leaves the browser open after for inspection.
4. **Watch the run** — the script logs the scene design output, the Higgsfield progress per slot, and the per-output DB attach.
5. **Report when done**:
   - N/6 succeeded count
   - Wall time
   - Review URL: `http://localhost:3000/review/<productId>`
   - If any slots failed, mention them. Re-running generates a fresh set of 6 (not idempotent in v1).

## Failure modes the wrapper handles

- **Higgsfield "Failed" widget** — auto-retry up to 2× per slot.
- **Profile lock from prior run** — pre-flight kill clears it.
- **Slug collision** — slugs include the slot index, no two slots collide.
- **Claude scene-designer returns fewer than 6 scenes** — the service pads by repeating the last valid scene with a `-padN` suffix.

## Failure modes the operator handles

- **Captcha widget** appears in the live browser — the user solves it manually (the wrapper detects Retry buttons, not full captcha widgets).
- **Higgsfield login expired** → user signs back in once; persistent profile remembers thereafter.
- **All retries failed for a slot** → that slot is dropped; other slots still attach. Re-run if you want a complete 6.

## Critical files

- `scripts/_lifestyle-image-creator.ts` — the entry point (resolves product → scenes → reference downloads → Higgsfield → DB attach).
- `scripts/_higgsfield-lifestyle.ts` — the Playwright wrapper, shared with hero generation. Hosts `runHiggsfieldBatch`, stealth, parallel tabs, claim coordination, retry detection.
- `src/services/lifestyle-scene-designer.service.ts` — Claude-driven per-product scene prompt designer. Edit the inlined `DAZUMA_SCENE_SYSTEM_PROMPT` to change scene direction.
- `.claude/skills/dazuma-aesthetic/SKILL.md` — the style bible the scene-designer's system prompt is derived from.

## Invocation in this project

```bash
# Clear stale Chrome holding the Higgsfield profile (PowerShell one-liner)
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*higgsfield-session*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Single-unit (default)
npx tsx scripts/_lifestyle-image-creator.ts http://localhost:3000/review/<productId> --headed

# Multi-unit (3 copies per frame)
npx tsx scripts/_lifestyle-image-creator.ts http://localhost:3000/review/<productId> --multi-unit 3 --headed

# Dry run — print scene prompts without calling Higgsfield
npx tsx scripts/_lifestyle-image-creator.ts http://localhost:3000/review/<productId> --dry-run
```

The script auto-loads `.env.local` for `ANTHROPIC_API_KEY` (scene designer) and Supabase credentials (output upload).
