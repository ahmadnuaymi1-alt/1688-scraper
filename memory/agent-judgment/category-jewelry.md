# Jewelry — category judgment rules

Applies when `Product.productType` matches jewelry categories (necklace / pendant / bracelet / ring / earrings / bolo tie / jewelry box, or title contains those tokens).

Sub-category cornucopias (own files in user memory): `lifestyle-cat-pendant-necklace.md`, `lifestyle-cat-bolo-tie.md`, `lifestyle-cat-jewellery-box.md`. Subcategory judgment files (subcategory-pendant.md etc) can be created if rules diverge.

---

- Rule: No people, no hands, no wrist/neck models — jewelry is shown standalone or in still-life
  Scope: category:jewelry
  Applies to: hero-critic, hero-generator, lifestyle-critic, lifestyle-generator
  Generator-delta: "no people, no hands, no wrist, no neck, no model body parts; jewelry shown standalone or in still-life arrangement only"
  Why: user standing approach for jewelry — display-only, no-person framing. See memory/lifestyle-cat-pendant-necklace.md and lifestyle-cat-bolo-tie.md.

- Rule: Macro-heavy framing — jewelry occupies enough of the frame for the buyer to read finish, stone, clasp, chain link detail
  Scope: category:jewelry
  Applies to: hero-critic, hero-generator
  Generator-delta: "macro framing — jewelry fills enough of the frame to clearly resolve finish, stones, clasp mechanism, chain link pattern; 100mm macro equivalent perspective"
  Why: small product, fine detail; buyer needs to see the metalwork. Default catalog framing under-resolves jewelry.

- Rule: Material fidelity — gold tone (yellow/rose/white) and gemstone colors preserved exactly per reference; no metal-finish averaging
  Scope: category:jewelry
  Applies to: hero-critic, hero-generator
  Generator-delta: "preserve exact metal tone (yellow gold / rose gold / white gold / silver) and exact gemstone color per reference; do not average mixed metals or shift gemstone hue"
  Why: same failure mode as watch two-tone bracelets — AI averages metal finishes.

- Rule: No alcohol, no kitchens, no dining rooms in jewelry lifestyle scenes
  Scope: category:jewelry
  Applies to: lifestyle-critic, lifestyle-generator
  Generator-delta: "no alcohol, no wine glasses, no kitchens, no dining room contexts"
  Why: user standing rule (covered by global no-alcohol; jewelry-specific reinforcement on kitchens/dining is part of the bolo-tie + watches anti-list).
