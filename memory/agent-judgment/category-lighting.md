# Lighting — category judgment rules

Applies when `Product.productType` matches lighting categories (chandelier / pendant / flush mount / sconce / wall light / table lamp / floor lamp / outdoor fixture / path light / step light / vanity light, or title contains those tokens).

Aesthetic reference: `.claude/skills/dazuma-aesthetic/SKILL.md`. Lifestyle archetypes: lifestyle-image-creator skill.

---

- Rule: Fixture bulb state mirrors the reference image — if reference shows bulb ON emitting light, output shows bulb ON at the SAME color temperature; if reference shows bulb OFF, output shows bulb OFF with no emission
  Scope: category:lighting
  Applies to: hero-critic, hero-generator
  Generator-delta: "mirror the reference image's bulb state EXACTLY — if reference shows the bulb ON and emitting light, the output must show the bulb ON at the SAME color temperature as the reference (do not shift warmer or cooler); if the reference shows the bulb OFF with no glow visible, the output must also show the bulb OFF with no emission, no glow, no light spill"
  Why: already in HERO_PROMPT but is the #1 lighting-hero failure mode. Critic must enforce.

- Rule: Per-variant fixture color-temp — derive each scene's fixture color-temp from its paired variant reference image (look at the DIFFUSER glow, not the wall bounce)
  Scope: category:lighting
  Applies to: hero-critic, hero-generator, lifestyle-generator
  Generator-delta: "derive the fixture color temperature from the diffuser/shade glow in the variant reference image, not the wall bounce; do not blanket-apply a color temp across variants"
  Why: user standing rule (memory/fixture-light-colour-per-variant.md). Don't trust verbal descriptions; trust the image.

- Rule: Bulb light does NOT project, spill, bloom, or cast onto the surrounding backdrop. Backdrop is a separately-white-balanced color field
  Scope: category:lighting
  Applies to: hero-critic, hero-generator
  Generator-delta: "the bulb's emitted light does not project onto, spill into, bloom across, or tint the backdrop in any way; backdrop is a separately gel-lit color field, treated as independent from the bulb emission"
  Why: Higgsfield will tint the backdrop with the bulb's color, ruining the clean catalog look.

- Rule: No visible plane corners — no ceiling-to-wall corner, no wall-to-floor corner, no horizon line marking surface transitions
  Scope: category:lighting
  Applies to: hero-critic, hero-generator
  Generator-delta: "infinite color field backdrop only; no visible ceiling plane, no ceiling-to-wall corner, no wall-to-floor corner, no horizon line, no plane transitions of any kind"
  Why: HERO_PROMPT already specifies this but is the most-leaked detail. Critic must enforce.

- Rule: Mounting surface is IMPLIED by product type (flush/pendant → ceiling, sconce → wall, floor lamp → floor, table lamp → tabletop) — never invent a mounting method the product wasn't built for
  Scope: category:lighting
  Applies to: hero-generator
  Generator-delta: (already encoded per-product in HERO_PROMPT; do not override)
  Why: changing a wall sconce into a freestanding object is a class of structural failure.

- Rule: Lifestyle generation defaults to single-unit. Do NOT use multi-unit flags unless the user explicitly asks
  Scope: category:lighting
  Applies to: lifestyle-generator
  Generator-delta: (controlled by orchestrator's `lifestyleUnitMix` setting; do not pass --multi-unit*)
  Why: user standing rule (memory/no-multi-unit-by-default.md).

- Rule: Dazuma-style fixture glow target = 2700-3000K warm
  Scope: category:lighting
  Applies to: lifestyle-generator
  Generator-delta: (passed to scene prompt as "fixture switched ON at 2700-3000K warm")
  Why: brand standard (memory/lifestyle-cat-jewellery-box.md → uses 2700K; dazuma-aesthetic skill).
