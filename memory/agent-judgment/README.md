# Agent judgment files

Scoped rules consumed by the future `/agent <url>` orchestrator (planned 2026-06-07). Loaded by the hero critic (post-generation Vision QA) and the hero generator (pre-generation prompt augmentation). See `~/.claude/plans/i-need-help-with-eager-leaf.md` and `memory/agent-mode-design-intent.md` (user auto-memory) for the full design.

## How files are picked per product

```
load: global.md
    + category-${normalize(Product.productType)}.md  (if exists)
    + subcategory-${slug}.md                          (if category file references one)
    + product-${id}.md                                (if exists — rare one-offs)
```

No LLM classifier. Falls back to title-keyword match if `productType` is null/garbage.

## Rule entry format

Every rule is a YAML-block-ish bullet with these fields:

```
- Rule: <one-line, present-tense, concrete>
  Scope: global | category:<slug> | subcategory:<slug> | product:<id>
  Applies to: hero-critic | hero-generator | lifestyle-critic | lifestyle-generator | variant-check | description-check
            (comma-separated list — most rules apply to BOTH critic AND generator)
  Generator-delta: "<concrete negative or positive prompt fragment to prepend at generation time>"
  Why: <one-line reason + ISO date — usually a past failure mode>
```

**Critical:** rules MUST feed both the critic and the generator (where applicable). A critic-only rule is a detector, not a learner — the same failure happens next run; the agent just catches it after burning credits. Generator-delta is what makes future runs less likely to need correction in the first place.

## Adding rules

Chat-driven. When the user corrects something during a run:
1. Claude infers scope from the conversation + the product being discussed.
2. If ambiguous (could be watches-only or all jewelry), Claude asks once.
3. For the first ~5 corrections, Claude shows the proposed scope before saving.
4. Append to the appropriate file with the structured header above.

Do NOT add rules speculatively. Add only what's been observed to fail (or what the user has explicitly stated).

## Integration with existing systems

- `hero-overrides/<productId>.json` (existing) — per-product `heroPromptExtraNotes`. The `product-<id>.md` judgment file's Generator-deltas should be emitted into this JSON for the existing `buildHeroPrompt()` consumption path. Don't duplicate the override mechanism.
- `src/lib/hero/prompt.ts:HERO_PROMPT_WATCH` etc — already category-tuned. Judgment-file rules **augment**, not replace.
- Curated lifestyle cornucopias (`lifestyle-cat-watches.md` etc in user memory) — orthogonal. Cornucopias define scene vocabulary; judgment files define hard rules.
