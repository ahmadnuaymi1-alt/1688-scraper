/**
 * Scene-library vision descriptions — Phase 2 of the lifestyle-scene refactor.
 *
 * For every scraped image in scene-library/sources/{brand}/, runs a Claude
 * Sonnet vision pass that produces a fixture-free scene description plus the
 * structured tag block, and merges { description, tags } into that image's
 * existing Phase-1 metadata sidecar JSON.
 *
 * Standalone — uses the Anthropic SDK directly; imports nothing from src/.
 *
 *   npx tsx scene-library/describe.ts             # full run (all images)
 *   npx tsx scene-library/describe.ts --limit=25  # Checkpoint-1 sample
 *
 * Re-running skips images whose sidecar already has a description.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve("scene-library");
const BRANDS = ["dazuma", "vakker"] as const;
const MODEL = "claude-sonnet-4-6";
const CONCURRENCY = 4;
const MAX_EDGE = 1536; // downscale long edge before sending to the vision model

// ── Load ANTHROPIC_API_KEY from .env.local (tsx does not auto-load it) ──
function loadEnvLocal(): void {
  try {
    const txt = readFileSync(path.resolve(".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      )
        v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* no .env.local — fall back to ambient env */
  }
}
loadEnvLocal();

/**
 * The Phase-2 vision prompt — used verbatim per the refactor spec. Do not
 * paraphrase: the no-fixture-language rules and the tag schema are exact.
 */
const VISION_PROMPT = `Analyze this interior photograph and generate a detailed scene description plus structured tags for use in AI image generation. Follow these rules with zero exceptions:

RULE 1 — NEVER describe any lighting fixture visible in the image as an OBJECT. Not the hero fixture, not accent fixtures, not any of them. Do not name their category, design, finishes, bulbs, shades, or placement. The product reference image will supply the hero fixture; any accent fixtures present in the source must be absent from your description's object-list.

RULE 2 — You MAY describe ambient and accent LIGHTING EFFECTS visible in the scene, without attributing them to specific fixture shapes.
- Acceptable: "a soft pool of warm light on the side table," "gentle illumination warming the artwork," "a warm glow washing into the corner from a low source"
- Forbidden: "a small table lamp on the side table," "a picture light above the artwork," "a sconce beside the bed"
Describe the lighting EFFECT, never the source's shape or type.

For scenes tagged source_hero_position = "floor" or "table" (non-ceiling products), the description MUST NOT include ANY language about lighting effects on the ceiling or coming from above — no "warm glow on the ceiling," no "ambient wash from overhead," no "soft light spilling from above." For floor and table lamp scenes, every lighting effect described must originate at the level of the lamp or below: pools of light on surfaces, warm illumination of the surrounding floor and walls, a gentle glow around the lamp's own height.

RULE 3 — Describe everything else fully: architecture, materials, color palette, furniture, decorative styling objects (vases, art, books, plants, rugs, textiles), window treatments, atmosphere, mood, time of day. Be specific and concrete.

RULE 4 — Describe the camera angle accurately. The source photographer chose this angle deliberately. Capture:
- Camera height (low ~2-3ft / seated ~3-4ft / standing ~5-6ft / elevated 7ft+)
- Lens character (wide ~24mm / normal ~35-50mm / telephoto)
- Composition (centered symmetrical / off-center thirds / one-point perspective looking down a corridor / three-quarter view of a corner / vignette / wide establishing / through doorway)
- Camera pitch (looking up / level / looking down, with rough degree if pronounced)
- What's visible in frame (full room / corner / vignette of one surface / passage shot)

Describe the angle in the room's terms, not the fixture's terms. "Camera at standing eye-level, three-quarter view of the corner of the room showing both walls and ceiling" is good. "Camera framed to center the pendant in the upper third" is forbidden — that describes the fixture's framing.

RULE 5 — End the description with this exact closing sentence and nothing else about lighting fixtures:

"A lighting fixture matching the product reference image is installed naturally within this scene at the appropriate location for the product category. Render the fixture exactly per the reference image — preserve all proportions, materials, finishes, and design details."

RULE 6 — Output structured tags as JSON alongside the description:

{
  "room_type": one of [kitchen, dining_room, bedroom, living_room, hallway, foyer, bathroom, home_office, library, sitting_room, sunroom, mudroom, outdoor, other],

  "mood": one of [quiet, lived_in, dramatic, romantic, scholarly, playful, formal, casual, moody, serene],

  "density": one of [low, mid] (low = 1-3 objects per surface, mid = 3-6 objects per surface),

  "color_palette_dominant": one of [warm_neutral, cool_neutral, earth_tones, jewel_tones, saturated_color, monochromatic],

  "color_accent": array of 0-2 specific accent colors visible (sage, cobalt, terracotta, oxblood, mustard, dusty_blue, forest_green, rust, plum, ochre, cognac, etc.),

  "primary_wood": one of [light_oak, walnut, painted_white, painted_dark, mixed, none],

  "primary_metal": one of [brass, matte_black, antique_brass, nickel, chrome, mixed, none],

  "architectural_features": array of features present [vaulted_ceiling, coffered_ceiling, exposed_beams, applied_moulding, shiplap, plaster, arched_doorway, french_door, multi_pane_window, picture_window, fireplace, herringbone_floor, stone_wall, wainscoting, paneled_walls],

  "aesthetic_flavor": one of [dazuma_clean, schoolhouse_moody, mcgee_color, amber_california, pierre_parisian, devol_country, allied_minimalist, visual_comfort_editorial, apparatus_gallery, modern_japandi],

  "product_category_fit": array of categories this scene's framing and surfaces can accommodate. Be honest — only include categories where a fixture of that type would be naturally placed within the visible frame. Multi-category is fine when the room genuinely supports multiple positions.

    Examples:
    - Passage shot looking down a hallway → [flush_mount, pendant, chandelier]
    - Living room with visible side table and floor space → [chandelier, table_lamp, floor_lamp]
    - Bedroom with visible nightstand and ceiling space → [table_lamp, sconce, chandelier, flush_mount, pendant]
    - Kitchen with visible island → [pendant, chandelier]
    - Console table vignette → [sconce, table_lamp]

    Possible categories: [chandelier, pendant, flush_mount, sconce, table_lamp, floor_lamp, outdoor],

  "source_hero_position": one of [ceiling, wall, table, floor] — where the source photo's PRIMARY fixture lived, i.e. the position the scene's framing was composed around:
    - "ceiling" — the source's hero fixture was mounted on or suspended from the ceiling (chandelier, pendant, flush mount)
    - "wall" — the source's hero fixture was wall-mounted (sconce, picture light, vanity light)
    - "table" — the source's hero fixture sat on a surface (table lamp, desk lamp)
    - "floor" — the source's hero fixture stood on the floor (floor lamp, torchiere, sculptural floor light),

  "camera_height": one of [low, seated, standing, elevated],

  "lens_character": one of [wide, normal, telephoto],

  "composition": one of [centered_symmetrical, three_quarter_corner, one_point_perspective, off_center_thirds, vignette, wide_establishing, through_doorway],

  "hero_position_clarity": one of [clear, ambiguous]
    - "clear" — one unambiguous primary lighting position (a centered ceiling spot, a focal sconce position above a console, a clear surface for a table lamp, etc.)
    - "ambiguous" — multiple equally-weighted positions compete for the hero role,

  "hero_prominence": one of [high, medium, low]
    - "high" — the hero fixture is the unambiguous focal subject of the photo. It occupies a meaningful portion of the frame (typically 10-25% of frame area), is well-lit relative to its surroundings, sits in or near the visual center or a rule-of-thirds power point, and a viewer's eye lands on it immediately.
    - "medium" — the hero fixture is a clear element of the scene but shares attention with other features. Roughly 5-10% of frame area, positioned in the upper third or middle ground, visible but not dominant.
    - "low" — the hero fixture is a background or corner element. Less than 5% of frame area, positioned at the edge of the frame, or set deep in the background. A viewer's eye does not naturally land on it — they discover it only after scanning the room.,

  "secondary_fixtures_status": one of [none, subordinate, competing]
    - "none" — only one fixture visible in the source
    - "subordinate" — secondary fixtures are ONLY tiny utilitarian accents (discreet recessed cans, undercabinet LEDs, small candle sconces with the bulb visible, purely functional picture lights). They occupy less than 5% of the frame area each, are NOT the kind of fixture a customer would buy as a standalone product, and do not glow brightly enough to draw the eye.
    - "competing" — ANY secondary fixture that is a sellable decorative lighting product: another table lamp, another floor lamp, a sculptural light, a statement pendant, a statement sconce, an ornamental chandelier. If a customer could plausibly Google the fixture and find it for sale, it is competing — regardless of its size relative to the hero. Also competing if any secondary fixture glows brightly enough to be a primary visual element. The test: would a customer looking at this scene be confused about which fixture is the product being sold? If yes, it is competing.
}

Return: { "description": "...", "tags": {...} }`;

/** Minimal concurrency limiter. */
function pLimit(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(release);
      };
      if (active < n) run();
      else queue.push(run);
    });
  };
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const status = (e as { status?: number })?.status;
      const retryable =
        status === undefined ||
        status === 429 ||
        status === 529 ||
        (status >= 500 && status < 600);
      if (i === tries - 1 || !retryable) throw e;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, i)));
    }
  }
  throw last;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}
function extractJson(s: string): string {
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

async function describeImage(
  imgPath: string,
): Promise<{ description: string; tags: Record<string, unknown> }> {
  const jpeg = await sharp(imgPath)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const res = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: jpeg.toString("base64"),
              },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    }),
  );

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = JSON.parse(extractJson(stripFences(text)));
  if (
    typeof parsed.description !== "string" ||
    !parsed.description.trim() ||
    typeof parsed.tags !== "object" ||
    !parsed.tags
  ) {
    throw new Error("malformed vision output (missing description or tags)");
  }
  return { description: parsed.description.trim(), tags: parsed.tags };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set (looked in .env.local).");
    process.exit(1);
  }
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

  // Build an interleaved image list across brands so a --limit sample spans both.
  const perBrand: Record<string, string[]> = {};
  for (const b of BRANDS) {
    const dir = path.join(ROOT, "sources", b);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      /* missing source dir */
    }
    perBrand[b] = files
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .map((f) => path.join(dir, f))
      .sort();
  }
  const interleaved: string[] = [];
  const maxLen = Math.max(0, ...BRANDS.map((b) => perBrand[b].length));
  for (let i = 0; i < maxLen; i++) {
    for (const b of BRANDS) {
      if (perBrand[b][i]) interleaved.push(perBrand[b][i]);
    }
  }

  // Keep only images whose sidecar lacks a description yet.
  const todo: string[] = [];
  for (const imgPath of interleaved) {
    const sidecar = imgPath.replace(/\.[^.]+$/, ".json");
    try {
      const meta = JSON.parse(await readFile(sidecar, "utf8"));
      if (typeof meta.description === "string" && meta.description.trim()) continue;
    } catch {
      /* sidecar missing/unreadable — still attempt */
    }
    todo.push(imgPath);
    if (todo.length >= limit) break;
  }

  console.log(
    `describe: ${todo.length} image(s) to process | model ${MODEL} | limit ${
      limit === Infinity ? "none" : limit
    }`,
  );

  const run = pLimit(CONCURRENCY);
  let done = 0;
  let failed = 0;
  await Promise.all(
    todo.map((imgPath) =>
      run(async () => {
        const sidecar = imgPath.replace(/\.[^.]+$/, ".json");
        try {
          const { description, tags } = await describeImage(imgPath);
          let meta: Record<string, unknown> = {};
          try {
            meta = JSON.parse(await readFile(sidecar, "utf8"));
          } catch {
            meta = { image_id: path.basename(imgPath).replace(/\.[^.]+$/, "") };
          }
          meta.description = description;
          meta.tags = tags;
          meta.vision_model = MODEL;
          meta.described_date = new Date().toISOString();
          await writeFile(sidecar, JSON.stringify(meta, null, 2));
          done++;
        } catch (e) {
          failed++;
          console.warn(`  FAIL ${path.basename(imgPath)}: ${(e as Error).message}`);
        }
        if ((done + failed) % 10 === 0 || done + failed === todo.length) {
          console.log(`  ${done + failed}/${todo.length} (${done} ok, ${failed} failed)`);
        }
      }),
    ),
  );

  console.log(`describe: DONE — ${done} described, ${failed} failed`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
