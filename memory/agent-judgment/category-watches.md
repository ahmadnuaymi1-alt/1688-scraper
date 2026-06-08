# Watches — category judgment rules

Applies when `Product.productType` matches `watch` / `watches` / `wristwatch` (or title contains "watch", "chronograph", "timepiece", "wristwatch").

Cornucopia for lifestyle scenes is separate: see user memory `lifestyle-cat-watches.md`.

---

- Rule: No paper price tag, hang tag, certificate card, paper label, QR code, barcode, sticker, or string attached to the watch
  Scope: category:watches
  Applies to: hero-critic, hero-generator
  Generator-delta: "no hang-tag, no certificate card, no paper label, no QR code, no barcode, no sticker, no string, no dangling tag, no rectangular white paper anywhere in frame, nothing attached to or beside the watch"
  Why: dominant watch-hero failure mode — 1688 supplier reference photos almost always show the watch with a certificate card / paper tag beside it, and Higgsfield averages that cue in. Flagged across cmpzixtaz00aow2hsqq59fqqx and cmpzifo4s003uw2hsxm35vqyf batches; the strip-tags regen script (_regen-watch-strip-tags.ts) exists specifically for this.

- Rule: No cushion, pillow, watch roll, watch holder, display bust, fabric pad, velvet roll, or presentation box under or through the band
  Scope: category:watches
  Applies to: hero-critic, hero-generator
  Generator-delta: "no cushion, no pillow, no watch roll, no watch holder, no display bust, no fabric pad, no velvet roll, no presentation box; watch floats on backdrop with only the faintest contact shadow"
  Why: same root cause as tags — supplier reference photos use these props, Higgsfield carries them through. Already encoded in HERO_PROMPT_WATCH but still leaks; needs critic enforcement.

- Rule: Watch case stands UPRIGHT at a 3/4 angle — dial rotated 25-30° off head-on, bracelet curving down to the lower-right. NOT flat-lay, NOT top-down, NOT pure side profile
  Scope: category:watches
  Applies to: hero-critic, hero-generator
  Generator-delta: "watch case stands vertically upright as if propped on its bracelet, dial faces the camera at 25-30 degrees rotation, bracelet curves down from the case toward lower-right of frame; not lying flat on caseback, not shot top-down, not in pure side profile"
  Why: the most-flagged watch failure (cmpzifo4s003uw2hsxm35vqyf had 4 user-flagged flat-lay heroes). The reference-orientation override in the existing hero-overrides JSON addresses this; encode it as a category rule so new products inherit automatically.

- Rule: Crystal reads fully transparent — dial face, hands, applied markers, brand text, model text, date numeral, and sub-dials are sharp and legible per the reference
  Scope: category:watches
  Applies to: hero-critic, hero-generator
  Generator-delta: "watch crystal is glare-free and fully transparent; dial face, hands, markers, brand name text, model text, date numeral, sub-dials all sharp and clearly legible exactly per the reference"
  Why: Higgsfield will blur or fake dial text when uncertain. Watches must show readable text — it's the buyer signal.

- Rule: Two-tone or per-link bracelet finishes preserved exactly per reference (gold/steel link distribution must not be averaged out)
  Scope: category:watches
  Applies to: hero-critic, hero-generator
  Generator-delta: "preserve two-tone bracelet exactly per reference — gold and steel link distribution unchanged, each link's finish matches the reference link by link"
  Why: AI averages metal finishes when two are present; user has manually re-flagged this.

- Rule: Case occupies ~40% of frame width; watch + bracelet together ~70%; case centered slightly above frame midpoint
  Scope: category:watches
  Applies to: hero-critic
  Generator-delta: (none — composition is set by the positioning template input, not the text prompt)
  Why: scale errors (case too small / overfills the frame) were classified as BAD by the existing _classify-watch-heroes.ts rubric.

- Rule: No transparent acrylic display stand, clear plastic watch holder, perspex prop, or invisible support of any kind under or behind the case
  Scope: category:watches
  Applies to: hero-critic, hero-generator
  Generator-delta: "absolutely no display stand of any kind under or behind the watch — no clear acrylic stand, no transparent plastic watch holder, no perspex prop, no acrylic display rod, no invisible support structure, no plinth, no riser, no platform; the watch must appear to float on the pale beige cove with only the faintest contact shadow under the bracelet, nothing visibly supporting the case"
  Why: dogfood 2026-06-07 on cmq3nwk6g000jw2hst5cwxfj8 variant #18 (Silver / Stainless Steel Bracelet). Higgsfield invented a clear acrylic display stand even with the standard "no cushion/holder" language. A first regen with explicit "no plastic stand" wording in the hero-override notes ALSO leaked the stand. This rule's Generator-delta uses much stronger phrasing — verify on the next watch product whether prepending it to the generator prompt prevents the failure. Failure mode is specific to bracelet/metal-strap watches where the supplier reference often has the watch propped on a stand.
