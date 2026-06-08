/**
 * Lifestyle Unit-Mix policy.
 *
 * Decides, for each of the 6 lifestyle slots, how many identical units of the
 * fixture should appear in the scene. The intent is a "subconscious upsell":
 * most lifestyle photos show 2-4 units so the customer pictures buying more
 * than one, but obviously one-per-room categories (table lamp, floor lamp,
 * chandelier) stay single-unit.
 *
 * Deterministic per product — randomness is seeded by the productId so the
 * same product always gets the same mix across runs.
 */
import type { LightingCategory } from "./lifestyle-scene-designer.service";

/** Categories where a customer typically buys exactly one — every scene is single-unit. */
const SINGLE_UNIT_CATEGORIES: ReadonlySet<LightingCategory> = new Set([
  "table-lamp",
  "floor-lamp",
  "chandelier",
]);

/** Multi-unit slot fill pool. Values are spread across slots; varying counts
 *  produces "different amounts of multi-unit" per the user's intent. Capped at
 *  3 — 4 was tried and dropped on 2026-05-25 because the image model struggled
 *  to render four identical units cleanly without compositional clutter. */
const MULTI_UNIT_VALUES = [2, 3] as const;

/** A tiny xmur3-based string-seeded PRNG. We don't pull in a dep — this only
 *  needs to be deterministic per productId, not cryptographically anything. */
function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return function () {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17; h >>>= 0;
    h ^= h << 5;  h >>>= 0;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Per-product mode override. Stored as `Product.lifestyleUnitMode` and read
 *  by the lifestyle scripts; matches the values accepted by the API. */
export type LifestyleUnitMode = "auto" | "single" | "multi";

/**
 * Decide the per-slot unit count for a 6-slot lifestyle batch.
 *
 * @param category    The product's lighting category (from `classifyCategory()`).
 * @param slotCount   The number of slots (typically 6).
 * @param productId   Optional seed for deterministic randomness across runs.
 *                    When omitted, the result is still varied but not reproducible.
 * @param mode        Optional per-product override.
 *                    - "auto" (or undefined) → category-based default.
 *                    - "single" → all single-unit, even for normally multi-unit categories.
 *                    - "multi" → force the 4-5 multi-unit mix, even for table-lamp / floor-lamp / chandelier.
 * @returns           An array of length `slotCount` where each entry is the
 *                    number of identical units to show in that slot (1 = single).
 */
export function decideUnitCounts(
  category: LightingCategory,
  slotCount: number,
  productId?: string,
  mode?: LifestyleUnitMode,
): number[] {
  if (mode === "single") {
    return Array(slotCount).fill(1);
  }
  const effectivelySingleUnit =
    mode !== "multi" && SINGLE_UNIT_CATEGORIES.has(category);
  if (effectivelySingleUnit) {
    return Array(slotCount).fill(1);
  }

  const rng = makeRng(productId ?? `unseeded-${category}-${slotCount}`);

  // Pick 4 or 5 multi-unit slots; the rest are single-unit. 4-vs-5 is itself
  // randomized so the mix varies across products.
  const multiSlotCount = rng() < 0.5 ? 4 : 5;
  const singleSlotCount = slotCount - multiSlotCount;

  // Fill multi-unit slots by cycling through the {2, 3, 4} pool — guarantees
  // every multi-unit batch covers a range of counts, not all the same number.
  const shuffledPool = shuffle([...MULTI_UNIT_VALUES], rng);
  const multiValues: number[] = [];
  for (let i = 0; i < multiSlotCount; i++) {
    multiValues.push(shuffledPool[i % shuffledPool.length]);
  }

  // Combine and shuffle whole-array so single-unit slots aren't always last.
  const combined = [
    ...multiValues,
    ...Array(singleSlotCount).fill(1),
  ];
  return shuffle(combined, rng);
}
