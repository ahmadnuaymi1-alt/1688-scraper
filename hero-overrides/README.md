# hero-overrides/

Per-product hero-prompt corrections, mirroring `scene-overrides/` for the lifestyle pipeline.

When the Gemini hero-vs-source check keeps flagging a product as a mismatch (after the automatic redos), add a `<productId>.json` file here with correction notes. Both hero scripts (`scripts/_hero-image-creator.ts`, `scripts/_hf-cli-bulk-heroes.ts`) read it via `buildHeroPrompt()` in `src/lib/hero/verify.ts` on the next run.

## File shape: `<productId>.json`

```json
{
  "productId": "cmp...",
  "productTitle": "Matte Black Aluminum Wall Sconce",
  "heroPromptExtraNotes": "The shade is matte black, NOT glossy. It is a single up/down box, not two separate fixtures.",
  "authoredBy": "added after Gemini flagged a finish mismatch",
  "authoredAt": "2026-06-03T00:00:00.000Z"
}
```

- `heroPromptExtraNotes` (common): appended to the end of `HERO_PROMPT` as highest-priority corrections.
- `heroPromptOverride` (rare): a FULL replacement of `HERO_PROMPT` for this product.

Precedence: env `HERO_PROMPT_OVERRIDE` > this file > `HERO_PROMPT`.
