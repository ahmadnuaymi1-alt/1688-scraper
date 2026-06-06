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

/** The four legitimate arrangement strategies, derived from the user's
 *  approved exemplars. Every multi-unit scene must declare one; an undeclared
 *  scene (or one missing an architectural anchor) is forced to "single". */
export type ArrangementStrategy =
  | "symmetric-flanking"   // count=2, bilateral anchor (door/arch/gate/fireplace/mirror)
  | "linear-sequence"      // count=3, long unbroken plane (deck wall, path wall, fence run)
  | "paired-marker"        // count=2, non-door bilateral anchor (window/stair landing/feature panel)
  | "single";              // count=1, the safe default — no qualifying anchor present

export interface DesignedScene {
  slug: string;
  /** Back-compat field; the consumer does not read it. Derived from scene
   *  density: low → "minimalist", mid → "homey". */
  mode: "minimalist" | "homey";
  prompt: string;
  variantPosition: number;
  /** Present when the scene declared (or was coerced into) an arrangement
   *  strategy. Surfaced for debug logs; downstream consumers may ignore it. */
  arrangementStrategy?: ArrangementStrategy;
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

/**
 * True iff the text names a LIGHTING product. `classifyCategory` can't answer
 * this (it returns "pendant" for everything non-lighting), so this is the
 * reliable branch test used to pick the lighting vs. general hero/lifestyle
 * path. Curated for HIGH PRECISION — a non-lighting product wrongly tagged as
 * lighting gets bulb-mirroring prompt language, which is worse than the reverse.
 * So it deliberately avoids ambiguous bare words ("light" → lightweight,
 * "pendant" → necklace pendant, "clamp" → lamp) and requires unambiguous
 * lighting terms or "<mount> light/lamp" phrases. The Chinese 灯 radical appears
 * in essentially every CN lighting title and is decisive on its own.
 */
export function isLightingProduct(text: string): boolean {
  const t = ` ${text.toLowerCase().replace(/[_/>|]+/g, " ")} `;
  if (t.includes("灯")) return true;
  if (/\b(sconces?|chandeliers?|torchieres?|luminaires?|downlights?|spotlights?|lighting)\b/.test(t)) return true;
  if (/\blamps?\b/.test(t)) return true; // \b avoids "clamp"
  if (/\bbulbs?\b/.test(t)) return true;
  // "<mount> light(s)" — avoids bare "light" and the jewellery sense of "pendant".
  if (/\b(ceiling|wall|floor|table|desk|pendant|hanging|vanity|night|string|led|step|stair|path|garden|porch|landscape|accent|reading|bedside)[- ]light(s|ing)?\b/.test(t)) return true;
  if (/\b(pendant|hanging|floor|table|desk|wall|reading|bedside)[- ]lamps?\b/.test(t)) return true;
  if (/\bflush[- ]?mount/.test(t)) return true;
  if (/\bwall lantern/.test(t)) return true;
  return false;
}

/**
 * Watch category test — wristwatches / chronographs / divers / dress watches.
 * Mirrors isLightingProduct's shape (word-boundary regex over a normalised
 * lowercase title). Used by buildHeroPrompt() to route to HERO_PROMPT_WATCH
 * and (via the lifestyle skill recipe) signal the scene-overrides path.
 *
 * Conservative — only matches when the title clearly says it's a watch.
 * Defaults to "not a watch" when there's no signal.
 */
export function isWatchProduct(text: string): boolean {
  const t = ` ${text.toLowerCase().replace(/[_/>|]+/g, " ")} `;
  // CN: 手表 (wristwatch) / 腕表 (wristwatch) — decisive. Bare 表 is too
  // generic (it also means "table" / "form") so we don't match it alone.
  if (t.includes("手表") || t.includes("腕表")) return true;
  if (/\b(watches?|wristwatch(es)?|chronographs?|timepieces?)\b/.test(t)) return true;
  return false;
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

/**
 * Verbatim positive + negative exemplars from the user's actual feedback on a
 * multi-unit batch. Appended to every multi-unit scene prompt as the last text
 * the image model reads — so the user's rubric carries recency weight against
 * the image model's tendency to "plop" extra fixtures. Single-unit scenes do
 * not need this; PRODUCT_FOCUS_DIRECTIVE already handles them.
 *
 * Hard rules embedded in the prose (do not soften without user sign-off):
 *   • count=1 is the SAFE DEFAULT — emit it whenever no bilateral or linear anchor exists.
 *   • count=4+ is BANNED.
 *   • "3-on-one-side, 1-on-the-other" is BANNED.
 *   • Every fixture must have a stated JOB (mark entry / light path / accent feature / anchor corner).
 */
export const ARRANGEMENT_EXEMPLAR_BANK = `
ARRANGEMENT EXEMPLAR BANK — these are the only arrangement patterns approved for this batch; match one positive exemplar exactly. If the scene fits none, render a single fixture.

POSITIVE EXEMPLARS (emulate these):
1. SYMMETRIC FLANK — Two identical sconces flanking an arched glass front door, one on each side, equidistant from the centerline, mirror-image, mounted at exactly the same height. The door is a bilateral architectural centerline; each fixture has the job of marking the entry. unitCount=2.
2. LINEAR SEQUENCE — Three sconces in an evenly-spaced row along a covered brick patio wall, all at the same mounting height, repeating along an unbroken plane. The long wall is a continuous linear anchor; the repetition reads as purposeful zonal lighting. unitCount=3.
3. LINEAR SEQUENCE (PATH-MARKING) — Three caged lanterns evenly spaced along a stucco garden wall at dusk, marching alongside a pathway. A path is a directional anchor; each fixture has the job of lighting the path. unitCount=3.
4. PAIRED MARKER — Two sconces flanking a stair landing window, mirror-image, equidistant from the window centerline, same mounting height. The window is a bilateral non-door anchor; the pair frames it as a feature. unitCount=2.
5. SINGLE (THE SAFE DEFAULT) — One sconce centered above a powder-room vanity mirror. No linear plane and no bilateral pair-anchor is present; a single fixture is the correct lighting-designer call. Better one beautiful unit than a forced multi. unitCount=1.

NEGATIVE EXEMPLARS (these were just generated and REJECTED — never repeat):
N1. Three sconces on a fence-and-gate-column where only a flanking pair on each side of the gate, or a single fixture on the center column, would make sense. Failure: feels "plopped"; the third fixture has no job.
N2. Three sconces crammed between a window and a door on a brick wall in an asymmetric arrangement (one isolated, two paired). Failure: visually broken; no centerline and no linear anchor.
N3. Three sconces split across three unrelated surfaces — one on a corner pillar, one on a far wall, one on a near wall. Failure: no coherent reason; three independent placements masquerading as a set.
N4. ANY 3-on-one-side and 1-on-the-other arrangement. HARD BAN — count mismatched across a centerline always fails.
N5. ANY count=4 or higher, OR any random clustering with no architectural anchor (long uninterrupted plane, bilateral centerline, or repeated structural element). HARD BAN.

LIGHTING-DESIGNER VOICE: every fixture in the frame must have a stated job — mark an entry, light a path, accent a feature, anchor a corner. Never include a fixture "to fill space."`;

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
  // Library scenes have no per-scene strategy declared, so resolve the
  // arrangement from the slot/uniform inputs — same discipline as the
  // override path. `unitCountVaried` here collapses to SINGLE (no anchor →
  // safe default per the user's rubric).
  const { strategy, unitCount } = resolveArrangement(
    undefined,
    input,
    slotUnitCount,
  );
  const clause = arrangementClause(strategy, undefined, unitCount);
  const body = clause ? `${description}${clause}` : description;
  const bankTail = unitCount > 1 ? `\n${ARRANGEMENT_EXEMPLAR_BANK}` : "";
  const tail = isCeilingMount
    ? `${PRODUCT_FOCUS_DIRECTIVE}${CEILING_ANGLE_HINT}${bankTail}`
    : `${PRODUCT_FOCUS_DIRECTIVE}${bankTail}`;
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
 * Map an arrangement strategy + anchor + unit count to concrete spatial
 * language the image model can act on. Returns the clause appended to the
 * scene prompt (empty string for `single`, which adds nothing).
 */
function arrangementClause(
  strategy: ArrangementStrategy,
  anchor: string | undefined,
  unitCount: number,
): string {
  const a = anchor && anchor.trim() ? anchor.trim() : null;
  switch (strategy) {
    case "symmetric-flanking": {
      const anchorPhrase = a ?? "the bilateral architectural centerline";
      return ` Show exactly 2 identical units of the fixture mirror-flanking ${anchorPhrase}: one on each side, equidistant from the centerline, mounted at exactly the same height, true mirror-image of each other. Heights match exactly. Distances from the centerline match exactly. No third unit anywhere in the frame.`;
    }
    case "paired-marker": {
      const anchorPhrase = a ?? "the bilateral feature";
      return ` Show exactly 2 identical units of the fixture marking ${anchorPhrase}: one on each side, equidistant from the centerline, mounted at the same height, mirror-image of each other — a deliberate paired marker, not a random pair. No third unit anywhere in the frame.`;
    }
    case "linear-sequence": {
      const anchorPhrase = a ?? "the long uninterrupted architectural plane";
      const n = unitCount >= 2 ? Math.min(unitCount, 3) : 3;
      return ` Show exactly ${n} identical units of the fixture in a linear sequence along ${anchorPhrase}: evenly spaced at equal intervals, all mounted at exactly the same height — a purposeful repeating element that marks the run as zonal lighting, not a random scatter. No clustering, no asymmetric grouping.`;
    }
    case "single":
    default:
      return "";
  }
}

/**
 * Resolve the per-scene strategy + unit count from override metadata. When
 * the author declared a strategy, use it; otherwise fall back to the legacy
 * slot/uniform unit-count behavior — but `unitCountVaried` is REINTERPRETED
 * as SINGLE (not a 2-4 cluster), because the user's rubric forbids forced
 * multi-unit without a declared architectural anchor.
 *
 * Safety clamps:
 *   • Any unitCount >= 4 is rewritten to 1 (HARD BAN per user rubric).
 *   • A non-single strategy with no anchor falls through to single.
 */
function resolveArrangement(
  scene: OverrideScene | undefined,
  input: SceneDesignerInput,
  slotUnitCount: number | undefined,
): { strategy: ArrangementStrategy; anchor?: string; unitCount: number } {
  if (scene?.strategy) {
    const s = scene.strategy;
    if (s === "single") return { strategy: "single", unitCount: 1 };
    if (!scene.anchor || !scene.anchor.trim()) {
      console.warn(
        `  scene-designer: scene declared strategy=${s} but no anchor — coercing to single-unit.`,
      );
      return { strategy: "single", unitCount: 1 };
    }
    let declared =
      typeof scene.unitCount === "number" && scene.unitCount > 0
        ? scene.unitCount
        : s === "linear-sequence"
          ? 3
          : 2;
    if (declared >= 4) {
      console.warn(
        `  scene-designer: scene declared unitCount=${declared} which violates the count=4+ HARD BAN — coercing to single-unit.`,
      );
      return { strategy: "single", unitCount: 1 };
    }
    return { strategy: s, anchor: scene.anchor, unitCount: declared };
  }
  if (typeof slotUnitCount === "number") {
    if (slotUnitCount >= 4) {
      console.warn(
        `  scene-designer: slot requested unitCount=${slotUnitCount} which violates the count=4+ HARD BAN — coercing to single-unit.`,
      );
      return { strategy: "single", unitCount: 1 };
    }
    return slotUnitCount > 1
      ? {
          strategy: slotUnitCount === 3 ? "linear-sequence" : "symmetric-flanking",
          anchor: undefined,
          unitCount: slotUnitCount,
        }
      : { strategy: "single", unitCount: 1 };
  }
  if (input.unitCountVaried) {
    // Per user rubric: forced multi-unit without a declared anchor is banned.
    // The override author is expected to declare a real strategy when
    // multi-unit is desired.
    return { strategy: "single", unitCount: 1 };
  }
  if (input.unitCount > 1) {
    if (input.unitCount >= 4) {
      return { strategy: "single", unitCount: 1 };
    }
    return {
      strategy: input.unitCount === 3 ? "linear-sequence" : "symmetric-flanking",
      unitCount: input.unitCount,
    };
  }
  return { strategy: "single", unitCount: 1 };
}

/**
 * Append the strategy-driven arrangement clause to a Claude-authored override
 * prompt. Unlike `buildPrompt()` this never appends `PRODUCT_FOCUS_DIRECTIVE`:
 * override prompts already carry their own product-lock and prominence
 * language, and the directive's "no other lighting" clause conflicts with the
 * deliberate layered second light source those prompts use. The exemplar bank
 * IS appended to multi-unit prompts as recency-weighted guidance.
 */
function applyUnitCount(
  prompt: string,
  input: SceneDesignerInput,
  slotUnitCount?: number,
  scene?: OverrideScene,
): { prompt: string; strategy: ArrangementStrategy } {
  const { strategy, anchor, unitCount } = resolveArrangement(
    scene,
    input,
    slotUnitCount,
  );
  const clause = arrangementClause(strategy, anchor, unitCount);
  const body = clause ? `${prompt}${clause}` : prompt;
  const out =
    unitCount > 1 ? `${body}\n${ARRANGEMENT_EXEMPLAR_BANK}` : body;
  return { prompt: out, strategy };
}

interface OverrideScene {
  slug?: string;
  mode?: "minimalist" | "homey";
  prompt?: string;
  /** 1-based slot index (1..6); maps to a `references[]` entry. */
  variantSlot?: number;
  /** The architectural element the fixture(s) attach to — "arched front
   *  door", "long covered-porch brick wall", "pair of stone pilasters", etc.
   *  Required for any non-single strategy; absent → coerced to SINGLE. */
  anchor?: string;
  /** Which of the four legitimate arrangement strategies this scene uses.
   *  Omitting it (or setting it to "single") forces single-unit rendering. */
  strategy?: ArrangementStrategy;
  /** Unit count for THIS scene. Must agree with `strategy`: symmetric-flanking
   *  and paired-marker imply 2, linear-sequence implies 3, single implies 1.
   *  Any value >= 4 is clamped to 1 (HARD BAN per user rubric). */
  unitCount?: number;
  /** 1-sentence designer rationale for choosing this strategy. Surfaced in
   *  dry-run logs for the human author; not embedded in the prompt. */
  justification?: string;
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

  // The override drives the scene COUNT now (not the variant-slot count): emit
  // exactly the override's scenes, clamped to 6–8 (general-products rule). If an
  // override carries <6 scenes (e.g. older 3-scene lighting overrides) we pad up
  // to 6 by cycling so we never regress below the old fixed-6 behaviour; >8 is
  // truncated. References are cycled when scenes outnumber variant slots.
  const refs = input.references;
  const targetCount = Math.min(Math.max(valid.length, 6), 8);
  const scenes: DesignedScene[] = Array.from({ length: targetCount }, (_, i) => {
    const padded = i >= valid.length;
    const src = valid[i % valid.length];
    // variantSlot is 1-based into refs; a missing/out-of-range value cycles.
    const slotIdx =
      typeof src.variantSlot === "number" &&
      src.variantSlot >= 1 &&
      src.variantSlot <= refs.length
        ? src.variantSlot - 1
        : i % refs.length;
    const baseSlug =
      src.slug && src.slug.trim() ? src.slug.trim() : `override-${i + 1}`;
    const slotRef = refs[slotIdx] ?? refs[i % refs.length];
    if (src.justification && src.strategy) {
      console.log(
        `  scene-designer: scene ${i + 1} strategy=${src.strategy} anchor="${src.anchor ?? "(none)"}" — ${src.justification}`,
      );
    }
    const applied = applyUnitCount(
      src.prompt!.trim(),
      input,
      slotRef?.unitCount,
      src,
    );
    return {
      slug: padded ? `${baseSlug}-pad${i}` : baseSlug,
      mode: src.mode === "homey" ? "homey" : "minimalist",
      prompt: applied.prompt,
      variantPosition: slotRef.variantPosition,
      arrangementStrategy: applied.strategy,
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
