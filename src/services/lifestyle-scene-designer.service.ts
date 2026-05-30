/**
 * Lifestyle Scene Designer — library-matching version.
 *
 * Phase 4 of the scene-library refactor. Instead of asking an LLM to invent
 * six lifestyle scenes per run, this matches the product to six real,
 * pre-described scenes drawn from the curated scene library
 * (`scene-library/curated/`). There is NO LLM call and NO per-run API cost.
 *
 * Two prompt sources:
 *   • Claude-authored override — if `scene-overrides/<productId>.json` exists,
 *     its six hand-designed prompts are used verbatim (see `loadOverride`).
 *   • Curated-library match — the fallback used whenever no override is present
 *     or the override file is malformed.
 *
 * The exported `SceneDesignerInput` / `SceneDesignerResult` shapes and the
 * `designLifestyleScenes()` signature are stable; `SceneDesignerInput.productId`
 * was added (optional) so the override file can be located.
 *
 * How a scene is matched to a product:
 *   1. Classify the product (per variant) into a lighting category from its
 *      title text — keyword-based, no LLM.
 *   2. Filter the library to scenes whose `product_category_fit` includes that
 *      category (a hard requirement).
 *   3. Greedily pick six scenes that are maximally varied — distinct room
 *      types, compositions and aesthetic flavors, a low/mid density mix — with
 *      soft nudges away from finish/aesthetic clashes.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ── Public contract (unchanged — keep in lockstep with the consumer) ────

export type LightingCategory =
  | "table-lamp"
  | "floor-lamp"
  | "wall-sconce"
  | "chandelier"
  | "pendant"
  | "flush-mount"
  | "outdoor";

export interface DesignedScene {
  slug: string;
  /** Back-compat field; the consumer does not read it. Derived from scene
   *  density: low → "minimalist", mid → "homey". */
  mode: "minimalist" | "homey";
  prompt: string;
  variantPosition: number;
}

export interface SceneDesignerInput {
  /** When set, a Claude-authored override at `scene-overrides/<productId>.json`
   *  is used instead of the curated-library match. Falls back to the library
   *  when the file is absent or malformed. */
  productId?: string;
  productTitle: string;
  productType: string | null;
  /** Unit count for the staging — 1 for single-unit, N for multi-unit. */
  unitCount: number;
  /** If true, vary the unit count (2-4) across the scenes. */
  unitCountVaried?: boolean;
  /** One row per output slot (typically 6). */
  references: Array<{
    slotIndex: number;
    variantPosition: number;
    variantTitle: string;
    /** Per-slot override of `input.unitCount`. When set, this slot uses the
     *  slot value instead of the top-level uniform value. Lets the caller
     *  mix single-unit + multi-unit scenes within one batch. */
    unitCount?: number;
  }>;
  /** Deprecated; retained for the script's call site. */
  hasSizeReference: boolean;
}

export interface SceneDesignerResult {
  category: LightingCategory;
  scenes: DesignedScene[];
}

// ── Curated scene library ──────────────────────────────────────────────

interface CuratedScene {
  scene_id: string;
  source_brand: string;
  description: string;
  tags: {
    room_type: string;
    density: "low" | "mid";
    color_accent: string[];
    primary_metal: string;
    architectural_features: string[];
    aesthetic_flavor: string;
    product_category_fit: string[];
    composition: string;
    source_hero_position?: string;
    hero_prominence?: string;
    [k: string]: unknown;
  };
}

const LIBRARY_DIR = path.resolve(process.cwd(), "scene-library", "curated");
const OVERRIDE_DIR = path.resolve(process.cwd(), "scene-overrides");
let _library: CuratedScene[] | null = null;

function loadLibrary(): CuratedScene[] {
  if (_library) return _library;
  if (!existsSync(LIBRARY_DIR)) {
    throw new Error(
      `Scene library not found at ${LIBRARY_DIR} — run scene-library/phase3-curate.ts first.`,
    );
  }
  const scenes: CuratedScene[] = [];
  for (const f of readdirSync(LIBRARY_DIR)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      const doc = JSON.parse(readFileSync(path.join(LIBRARY_DIR, f), "utf8"));
      if (doc && typeof doc.description === "string" && doc.tags?.product_category_fit) {
        scenes.push(doc as CuratedScene);
      }
    } catch {
      /* skip an unreadable curated file */
    }
  }
  if (scenes.length === 0) throw new Error(`Scene library at ${LIBRARY_DIR} is empty.`);
  _library = scenes;
  return scenes;
}

// ── Product classification (keyword-based, no LLM) ─────────────────────

/** designer category → the library's `product_category_fit` token. */
const LIB_CATEGORY: Record<LightingCategory, string> = {
  "table-lamp": "table_lamp",
  "floor-lamp": "floor_lamp",
  "wall-sconce": "sconce",
  chandelier: "chandelier",
  pendant: "pendant",
  "flush-mount": "flush_mount",
  outdoor: "outdoor",
};

/**
 * Required `source_hero_position` per product category — a HARD match filter.
 * A scene's framing and lighting are built around where its source hero lived,
 * so a product must inherit that exact position. `outdoor` is omitted: an
 * outdoor fixture's mount position is genuinely variable (wall / post / eave).
 */
const HERO_POSITION: Partial<Record<LightingCategory, string>> = {
  chandelier: "ceiling",
  pendant: "ceiling",
  "flush-mount": "ceiling",
  "wall-sconce": "wall",
  "table-lamp": "table",
  "floor-lamp": "floor",
};

/** Last segment of a "A > B > C" category path — the most specific token.
 *  Exported alongside `classifyCategory` for caller reuse. */
export function typeLeaf(productType: string | null): string {
  if (!productType) return "";
  const parts = productType.split(/[>›/|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : productType;
}

/**
 * Classify a fixture into one of the seven lighting categories from its
 * title text (English + common Chinese supplier terms), checked in priority
 * order so the more specific signal wins.
 *
 * Exported so callers (the lifestyle scripts) can derive the same category
 * the scene designer uses, without duplicating the keyword table.
 */
export function classifyCategory(text: string): LightingCategory {
  const t = text.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));

  // Step / path / stair lights — small recessed or wall-flush fixtures that
  // sit at ankle/shin height alongside a stair tread, garden path, deck
  // edge, or hotel corridor floor. They share the outdoor scene pool because
  // the curated library's outdoor scenes already cover the visual context
  // (stair runs, paths, garden edges, deck-mounted accents) better than any
  // indoor scene would. Chinese tokens cover the most common supplier
  // titles; English covers Western-curated catalog text.
  if (has(
    "地脚灯", "楼梯灯", "台阶灯", "踏步灯", "墙脚灯", "嵌入式地脚",
    "step light", "stair light", "stair-light", "tread light", "footlight",
    "foot light", "floor accent light", "ground recessed",
  ))
    return "outdoor";
  if (has("户外", "outdoor", "exterior", "garden light", "path light", "landscape light", "bollard", "wall lantern", "post light", "porch", "庭院灯", "花园灯", "阳台灯"))
    return "outdoor";
  if (has("壁灯", "sconce", "wall lamp", "wall light", "vanity light", "wall-mounted"))
    return "wall-sconce";
  if (has("落地灯", "floor lamp", "floor-lamp", "standing lamp", "torchiere"))
    return "floor-lamp";
  if (has("chandelier")) return "chandelier";
  if (has("吸顶", "flush mount", "flush-mount", "semi-flush")) return "flush-mount";
  if (has("吊灯", "pendant", "hanging light", "hanging lamp", "suspension")) return "pendant";
  if (has("台灯", "table lamp", "desk lamp", "bedside", "accent lamp")) return "table-lamp";
  if (t.includes("lamp") && !t.includes("ceiling")) return "table-lamp";
  return "pendant";
}

/** Coarse metal finish of the product, from its title. */
function detectFinish(title: string): string | null {
  const t = title.toLowerCase();
  if (/\b(brass|gold|golden)\b/.test(t)) return "brass";
  if (/\bmatte[- ]?black\b/.test(t) || /\bblack\b/.test(t)) return "matte_black";
  if (/\bchrome\b/.test(t)) return "chrome";
  if (/\bnickel\b/.test(t)) return "nickel";
  return null;
}

/** True when a scene's dominant metal would clearly clash with the product. */
function metalClash(finish: string, sceneMetal: string): boolean {
  if (sceneMetal === "mixed" || sceneMetal === "none" || !sceneMetal) return false;
  const warmScene = sceneMetal === "brass" || sceneMetal === "antique_brass";
  const coolScene = sceneMetal === "chrome" || sceneMetal === "nickel";
  if (finish === "brass" && coolScene) return true;
  if ((finish === "chrome" || finish === "nickel") && warmScene) return true;
  if (finish === "matte_black" && warmScene) return true;
  return false;
}

/** Coarse product vibe used for soft aesthetic-flavor nudging. */
function productVibe(title: string): "minimalist" | "ornate" | null {
  const t = title.toLowerCase();
  if (/\b(minimalist|minimal|nordic|scandi|japandi)\b/.test(t)) return "minimalist";
  if (/\b(crystal|luxury|luxurious|ornate|baroque|vintage|classic)\b/.test(t)) return "ornate";
  return null;
}
const VIBE_AVOID: Record<string, Set<string>> = {
  minimalist: new Set([
    "schoolhouse_moody", "mcgee_color", "pierre_parisian", "devol_country",
    "visual_comfort_editorial",
  ]),
  ornate: new Set(["allied_minimalist", "modern_japandi", "apparatus_gallery"]),
};

// ── Matching ───────────────────────────────────────────────────────────

/**
 * Closing directive appended to EVERY scene prompt. The curated description
 * stages the room but says nothing about how prominently to render the
 * product — which let the image model hide the fixture behind furniture and
 * invent competing decorative lamps. This is the last text the model reads,
 * so it carries recency weight.
 */
const PRODUCT_FOCUS_DIRECTIVE = `

PRODUCT FOCUS — CRITICAL: The lighting fixture shown in the reference image is the one product this photograph exists to sell. It must be the unmistakable main focus of the whole scene.
- PROMINENCE: Render it large, well-lit, and centrally placed — it occupies a significant share of the frame and is the first thing the eye lands on. The room is only its setting. Never render it small, distant, or as a minor background detail.
- FULL VISIBILITY: Show the product complete and entirely unobstructed — its whole form, top to bottom, in clear view. Nothing may stand in front of it or overlap it; it must never be hidden, blocked, cropped, or tucked behind a sofa, desk, chair, drapery, or any other furniture or object. Keep the space around it clear.
- NO OTHER LIGHTING: No lamp, sconce, pendant, chandelier, lit candle, or glowing decorative light fixture may appear anywhere in the frame other than the reference product itself. Any warm glow, pool of light, or ambient illumination mentioned above is atmospheric light only — do not add a second physical light source to produce it.
- LIGHT COLOR FIDELITY: The fixture's emitted light must match the color temperature shown in the reference product image. If the reference shows a warm yellow/amber glow, render warm. If the reference shows a cool/neutral white, render cool/neutral. Do not invent a different bulb color than what the reference depicts.`;

/**
 * Ceiling-mount fixtures (flush-mount / pendant / chandelier) tend to read
 * "copy-pasted" across a 6-scene batch because the camera defaults to the
 * same standing eye-level for every shot. One short, optional nudge — only
 * appended for ceiling categories — encouraging the rendering to settle on
 * the camera height the scene description implies, rather than forcing
 * everything to the same default.
 */
const CEILING_ANGLE_HINT = `
- CAMERA HEIGHT: Use the camera height the scene description implies (close, mid-room, doorway, etc.) — do not anchor every shot at the same standing eye-level. Vary subtly across the batch.`;

/** Append the unit-count instruction (multi-unit only) and the product-focus
 *  directive to the curated scene description.
 *
 *  When `slotUnitCount` is provided it overrides the input's uniform setting —
 *  this is how a single batch can mix single-unit + multi-unit scenes. The
 *  top-level `unitCountVaried` is ignored in that case (per-slot is more
 *  specific). */
function buildPrompt(
  description: string,
  input: SceneDesignerInput,
  slotUnitCount?: number,
  isCeilingMount?: boolean,
): string {
  let body = description;
  if (typeof slotUnitCount === "number") {
    if (slotUnitCount > 1) {
      body = `${description} Show ${slotUnitCount} identical units of the fixture, arranged naturally within the scene.`;
    }
    // slotUnitCount === 1 → no unit-count clause (single-unit).
  } else if (input.unitCountVaried) {
    body = `${description} Show a small matching cluster of identical units of the fixture — between two and four — arranged naturally within the scene.`;
  } else if (input.unitCount > 1) {
    body = `${description} Show ${input.unitCount} identical units of the fixture, arranged naturally within the scene.`;
  }
  const tail = isCeilingMount
    ? `${PRODUCT_FOCUS_DIRECTIVE}${CEILING_ANGLE_HINT}`
    : PRODUCT_FOCUS_DIRECTIVE;
  return `${body}${tail}`;
}

/**
 * Greedily pick one scene per reference slot, maximising variety across the
 * batch (distinct room types, compositions and flavors; a low/mid density
 * mix) while honouring each slot's lighting category.
 */
function pickScenes(input: SceneDesignerInput, library: CuratedScene[]): DesignedScene[] {
  const leaf = typeLeaf(input.productType);
  const finish = detectFinish(input.productTitle);
  const vibe = productVibe(input.productTitle);
  const vibeAvoid = vibe ? VIBE_AVOID[vibe] : null;
  // Minimalist products skew toward low-density scenes.
  const targetMid = vibe === "minimalist" ? 2 : 3;

  const used = {
    ids: new Set<string>(),
    rooms: new Set<string>(),
    comps: new Set<string>(),
    flavors: new Set<string>(),
    accents: new Set<string>(),
    arch: new Set<string>(),
  };
  let midCount = 0;
  let lowCount = 0;
  let mediumUsed = 0; // hero_prominence === "medium" scenes picked so far

  const out: DesignedScene[] = [];
  for (const slot of input.references) {
    const category = classifyCategory(`${slot.variantTitle} ${input.productTitle} ${leaf}`);
    const libCat = LIB_CATEGORY[category];
    const wantOutdoor = category === "outdoor";
    const requiredHeroPos = HERO_POSITION[category];

    // Hard rules, never relaxed: (a) source_hero_position must match the
    // product's mount position; (b) an outdoor fixture only gets outdoor
    // scenes and an indoor fixture never gets an outdoor scene; (c) never a
    // low-prominence scene, and at most one medium-prominence scene per batch
    // (so >= 5 of 6 are high-prominence).
    const heroOk = (s: CuratedScene) =>
      !requiredHeroPos || s.tags.source_hero_position === requiredHeroPos;
    const promOk = (s: CuratedScene) =>
      s.tags.hero_prominence !== "low" &&
      (mediumUsed < 1 || s.tags.hero_prominence !== "medium");
    let pool = library.filter(
      (s) =>
        !used.ids.has(s.scene_id) &&
        heroOk(s) &&
        promOk(s) &&
        s.tags.product_category_fit.includes(libCat) &&
        (s.tags.room_type === "outdoor") === wantOutdoor,
    );
    if (pool.length === 0) {
      // Relax category-fit and room only — hero-position and prominence hold.
      pool = library.filter(
        (s) => !used.ids.has(s.scene_id) && heroOk(s) && promOk(s),
      );
    }

    const wantMid = midCount < targetMid;
    const wantLow = lowCount < 6 - targetMid;

    let best: CuratedScene | null = null;
    let bestScore = -Infinity;
    for (const s of pool) {
      let score = 0;
      if (!used.rooms.has(s.tags.room_type)) score += 100;
      if (!used.comps.has(s.tags.composition)) score += 40;
      if (!used.flavors.has(s.tags.aesthetic_flavor)) score += 30;
      if (s.tags.density === "mid" && wantMid) score += 25;
      if (s.tags.density === "low" && wantLow) score += 25;
      for (const a of s.tags.color_accent ?? []) if (used.accents.has(a)) score -= 6;
      for (const a of s.tags.architectural_features ?? []) if (used.arch.has(a)) score -= 3;
      if (finish && metalClash(finish, s.tags.primary_metal)) score -= 20;
      if (vibeAvoid && vibeAvoid.has(s.tags.aesthetic_flavor)) score -= 15;
      score += Math.random() * 5; // jitter — run-to-run variety
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    const chosen = best!;

    used.ids.add(chosen.scene_id);
    used.rooms.add(chosen.tags.room_type);
    used.comps.add(chosen.tags.composition);
    used.flavors.add(chosen.tags.aesthetic_flavor);
    for (const a of chosen.tags.color_accent ?? []) used.accents.add(a);
    for (const a of chosen.tags.architectural_features ?? []) used.arch.add(a);
    if (chosen.tags.density === "mid") midCount++;
    else lowCount++;
    if (chosen.tags.hero_prominence === "medium") mediumUsed++;

    out.push({
      slug: `${chosen.tags.room_type}-${chosen.scene_id.slice(-6)}`,
      mode: chosen.tags.density === "mid" ? "homey" : "minimalist",
      prompt: buildPrompt(
        chosen.description,
        input,
        slot.unitCount,
        requiredHeroPos === "ceiling",
      ),
      variantPosition: slot.variantPosition,
    });
  }
  return out;
}

// ── Claude-authored override ───────────────────────────────────────────

/** True when `v` is one of the seven lighting categories. */
function isLightingCategory(v: unknown): v is LightingCategory {
  return (
    typeof v === "string" &&
    Object.prototype.hasOwnProperty.call(LIB_CATEGORY, v)
  );
}

/**
 * Append only the unit-count instruction (multi-unit staging). Unlike
 * `buildPrompt()` this never appends `PRODUCT_FOCUS_DIRECTIVE`: Claude-authored
 * override prompts already carry their own product-lock and prominence
 * language, and the directive's "no other lighting" clause conflicts with the
 * deliberate layered second light source those prompts use.
 */
function applyUnitCount(
  prompt: string,
  input: SceneDesignerInput,
  slotUnitCount?: number,
): string {
  if (typeof slotUnitCount === "number") {
    if (slotUnitCount > 1) {
      return `${prompt} Show ${slotUnitCount} identical units of the fixture, arranged naturally within the scene.`;
    }
    return prompt; // explicit single-unit
  }
  if (input.unitCountVaried) {
    return `${prompt} Show a small matching cluster of identical units of the fixture — between two and four — arranged naturally within the scene.`;
  }
  if (input.unitCount > 1) {
    return `${prompt} Show ${input.unitCount} identical units of the fixture, arranged naturally within the scene.`;
  }
  return prompt;
}

interface OverrideScene {
  slug?: string;
  mode?: "minimalist" | "homey";
  prompt?: string;
  /** 1-based slot index (1..6); maps to a `references[]` entry. */
  variantSlot?: number;
}

/**
 * If a Claude-authored override exists for this product, load and return it.
 * The override file `scene-overrides/<productId>.json` supplies hand-designed
 * scene prompts that replace the curated-library match.
 *
 * Returns null — so the caller falls back to the library — when there is no
 * `productId`, no file, or the file is malformed. Never throws.
 */
function loadOverride(input: SceneDesignerInput): SceneDesignerResult | null {
  if (!input.productId) return null;
  const file = path.join(OVERRIDE_DIR, `${input.productId}.json`);
  if (!existsSync(file)) return null;

  let doc: { category?: unknown; scenes?: unknown };
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.warn(
      `  scene-designer: override file unreadable — falling back to library (${file}): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }

  const rawScenes: OverrideScene[] = Array.isArray(doc.scenes)
    ? (doc.scenes as OverrideScene[])
    : [];
  const valid = rawScenes.filter(
    (s) => !!s && typeof s.prompt === "string" && s.prompt.trim().length > 0,
  );
  if (valid.length === 0) {
    console.warn(
      `  scene-designer: override file has no usable scenes — falling back to library (${file}).`,
    );
    return null;
  }

  const refs = input.references;
  const scenes: DesignedScene[] = refs.map((_, i) => {
    const padded = i >= valid.length;
    const src = valid[Math.min(i, valid.length - 1)];
    // variantSlot is 1-based; a missing/out-of-range value maps positionally.
    const slotIdx =
      typeof src.variantSlot === "number" &&
      src.variantSlot >= 1 &&
      src.variantSlot <= refs.length
        ? src.variantSlot - 1
        : i;
    const baseSlug =
      src.slug && src.slug.trim() ? src.slug.trim() : `override-${i + 1}`;
    const slotRef = refs[slotIdx] ?? refs[i];
    return {
      slug: padded ? `${baseSlug}-pad${i}` : baseSlug,
      mode: src.mode === "homey" ? "homey" : "minimalist",
      prompt: applyUnitCount(src.prompt!.trim(), input, slotRef?.unitCount),
      variantPosition: slotRef.variantPosition,
    };
  });

  const category: LightingCategory = isLightingCategory(doc.category)
    ? doc.category
    : classifyCategory(`${input.productTitle} ${typeLeaf(input.productType)}`);

  return { category, scenes };
}

/**
 * Design six lifestyle scenes for a product. When a Claude-authored override
 * exists (`scene-overrides/<productId>.json`) its prompts are used verbatim;
 * otherwise the product is classified from its title and matched to six
 * varied, category-appropriate curated scenes from `scene-library/curated/`
 * (keyword-based, no LLM call).
 */
export async function designLifestyleScenes(
  input: SceneDesignerInput,
): Promise<SceneDesignerResult> {
  const override = loadOverride(input);
  if (override) {
    console.log(
      `  scene-designer: using Claude override scene-overrides/${input.productId}.json (${override.scenes.length} scene(s)).`,
    );
    return override;
  }

  const library = loadLibrary();
  const scenes = pickScenes(input, library);
  const category = classifyCategory(
    `${input.productTitle} ${typeLeaf(input.productType)}`,
  );
  return { category, scenes };
}
