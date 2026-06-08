# Global judgment rules

Applies to EVERY product, every category. Cross-product invariants only — anything category-specific belongs in the category file.

---

- Rule: No alcohol of any kind in generated lifestyle or scene images
  Scope: global
  Applies to: lifestyle-critic, lifestyle-generator
  Generator-delta: "no alcohol, no wine glasses, no bottles, no spirits, no cocktails, no beer"
  Why: user standing rule (see memory/no-alcohol-in-images.md, dated long-standing)

- Rule: No people, hands, faces, or body parts in hero shots
  Scope: global
  Applies to: hero-critic, hero-generator
  Generator-delta: "no people, no hands, no faces, no body parts visible anywhere in frame"
  Why: hero shots are catalog isolations of the product; people belong in lifestyle pass only. Already in HERO_PROMPT_GENERAL/WATCH; included here for critic enforcement.

- Rule: No text overlays, watermarks, captions, brand logos, or signage rendered into the image
  Scope: global
  Applies to: hero-critic, hero-generator, lifestyle-critic, lifestyle-generator
  Generator-delta: "no text overlay, no caption, no watermark, no brand logo signage, no rendered text on or near the product"
  Why: shipped images must be clean; rendered text artifacts are an AI-image-gen failure mode flagged across multiple batches.

- Rule: Product fidelity must match the reference image exactly — finish, color, proportions, hardware, construction
  Scope: global
  Applies to: hero-critic, hero-generator
  Generator-delta: "preserve EXACT product design, materials, finish, color, proportions, hardware, and construction from the reference image; every component visible in the reference must appear in the output unchanged"
  Why: AI image gen drifts product details; catalog images that don't match the actual SKU cause returns.

- Rule: Photorealistic only — no illustration, no cartoon, no stylized render
  Scope: global
  Applies to: hero-critic, hero-generator, lifestyle-critic, lifestyle-generator
  Generator-delta: "photorealistic, sharp focus, professional studio or editorial photography quality"
  Why: brand standard.
