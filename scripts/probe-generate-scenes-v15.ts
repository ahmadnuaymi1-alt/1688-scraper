/**
 * v15 — Solar-powered outdoor LED linear wall sconce, applying the angle library to a NEW category.
 *
 * Distribution validation:
 *   Fixture %: PROMINENT 13%, PROMINENT 10%, CONTEXTUAL 5%, DOMINANT 20% → ≥1 DOMINANT ✓, ≥1 CONTEXTUAL ✓
 *   Heights:   STANDING 5.25, STANDING 5, STANDING 5.5, LOW 3 → 1 LOW (outdoor wall sconces naturally STANDING-dominant; accepted)
 *   Lenses:    NORMAL 40, WIDE 26, WIDE 24, WIDE-NORMAL 30 → 3 distinct classes ✓
 *   Pitch:     level, slight up 3°, level, UP 25° → varied
 *   Time:      blue hour, evening, golden hour, evening — varied ✓
 *
 * Angle × scene pairs (validated against outdoor.md Best-for / NOT-for):
 *   FRONT-DOOR-AXIAL-DUSK         × L42  Cotswolds paired sconces blue hour fog
 *   CORNER-OF-HOUSE-3-QUARTER     × L115 Mediterranean single sconce evening
 *   FRONT-FACADE-FULL-ESTABLISHING× L475 Italianate row of three sconces golden hour
 *   FACADE-LOOK-UP-FROM-WALK*     × L195 Dazuma-canonical craftsman single sconce evening
 *
 * *FACADE-LOOK-UP-FROM-WALK is a CUSTOM-ADAPTED low variant of OFF-CENTER-SCONCE-DAYTIME
 *  (LOW 3 ft camera, UP 25° pitch, WIDE-NORMAL 30mm lens, DOMINANT 20% fixture). Needed to hit
 *  ≥1 DOMINANT and ≥1 non-standing — the outdoor wall sconce angle vocabulary in outdoor.md
 *  is naturally STANDING-dominant.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const KIE_ENDPOINT = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL_ENDPOINT = "https://api.kie.ai/api/v1/jobs/recordInfo";
const KIE_MODEL = "nano-banana-pro";
const KIE_POLL_INTERVAL_MS = 5_000;
const KIE_TIMEOUT_MS = 8 * 60 * 1000;
const RESOLUTION = process.env.SCENE_RESOLUTION || "1K";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const REF = path.join(os.tmpdir(), "scene", "p2", "p2_1.jpg");

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — modern solar-powered outdoor LED linear wall sconce. Long horizontal rectangular form, approximately 4-5x as long as it is tall, mounted flush to an exterior wall on a slim black mounting plate. The TOP surface is angled upward at approximately 30-45° and is occupied by a flat polycrystalline solar panel with visible dark-blue silicon cell grid pattern. The FRONT/UNDERSIDE face is a flat white opal acrylic diffuser that emits warm light when switched on. Body is matte-black powder-coated aluminum with crisp chamfered edges. No exposed bulb. Mounting is high on the wall above doors / windows / corners as a facade fixture.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

EXTERIOR ATMOSPHERE — sky must read authentically: real atmospheric sky with appropriate time-of-day gradients (blue hour, golden hour, evening). NOT pure-white blown-out, NOT cartoonish saturated. Real trees, branches, hedges visible. Soft natural rolloff between sky and architecture.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // ANGLE: FRONT-DOOR-AXIAL-DUSK × SCENE: L42 Cotswolds paired sconces blue hour fog
  {
    slug: "v15_FRONT_DOOR_AXIAL_DUSK_cotswolds_paired_blue_hour",
    prompt:
      "CAMERA ANGLE — FRONT-DOOR-AXIAL-DUSK: This is a front-door axial shot taken from a STANDING camera position 5.25 ft off the floor. The lens is NORMAL 40mm focal length — undistorted natural perspective. The viewer stands directly in front of the entry, axially centered on the door. A PAIR of identical linear wall sconces flank the door symmetrically — one to the left, one to the right, both mounted at the same height on the limestone surround. The flanking fixture PAIR occupies 13 PERCENT of the frame combined — PROMINENT scale. Camera pitch is level. Deep depth-of-field. Reference: Dazuma front-door blue-hour signature. " +
      "POOL ANCHOR (Line 42): Paired sconces flanking a limestone-arched cedar door with iron viewport + clipped yew + Cotswolds — blue hour, light fog near treeline. The architecture: a Cotswolds-style stone cottage facade with hand-laid honey-coloured limestone in irregular courses; a tall arched limestone surround frames the entry; a solid cedar plank door darkened to deep walnut, with a small black wrought-iron viewport at eye level; a worn limestone step at the threshold. ACCENT PALETTE — honey limestone + weathered cedar + iron + soft sage: two clipped yew topiaries in aged terracotta urns flank the door at the base, each balanced symmetrically left and right; a hand-loomed soft-sage doormat at the threshold; a small iron boot-scrape mounted on the wall; the path leading up to the door is laid in irregular limestone flags with soft mossy joints; clipped yew hedges along the path edge. Blue hour with light fog drifting near the treeline behind the cottage: silhouetted bare branches and yew hedges against a deep violet-grey sky graded to a warm amber band at horizon, faint atmospheric haze softening the edges. The pair of fixtures is identical to the reference — modern solar-powered linear wall sconces, mounted symmetrically on the limestone left and right of the arched cedar door at standard 7-foot facade height, black housings with their angled-up solar panels matte against the limestone, the flat white opal diffuser face down-and-forward emitting warm 2700-3000K light that washes the limestone in symmetric pools. Designer-inhabited custom residence.",
  },
  // ANGLE: CORNER-OF-HOUSE-3-QUARTER × SCENE: L115 Mediterranean single sconce evening
  {
    slug: "v15_CORNER_OF_HOUSE_3_QUARTER_mediterranean_single",
    prompt:
      "CAMERA ANGLE — CORNER-OF-HOUSE-3-QUARTER: This is a corner-of-house shot taken from a STANDING camera position 5 ft off the floor. The lens is WIDE 26mm focal length — captures two facade walls at a three-quarter oblique angle. The fixture is positioned in the upper-third of the frame on the visible wall and occupies 10 PERCENT of the frame area — PROMINENT scale. Camera pitch tilts very slight up 3° to register more of the facade up to the eave. Deep depth-of-field. Two facade walls meet at the corner in the center-back of the frame; the linear sconce is mounted on the right-hand wall above an arched timber shutter. Reference: AD / Architectural Digest exterior facade editorial. " +
      "POOL ANCHOR (Line 115): Single sconce on cream stucco with terracotta tile + arched timber shutters + lavender row + Mediterranean — evening, thin warm horizon band, navy zenith. The architecture: hand-rendered cream lime-stucco facade with subtle texture variation visible at the corner where two walls meet; the visible eave above the wall is finished with antique terracotta-tile capping in warm ochre; arched timber shutters in weathered chestnut, open and fastened back against the wall, frame a deep-set casement window beneath the fixture; a slim cream-stucco corner pilaster delineates the wall junction. ACCENT PALETTE — cream stucco + terracotta + weathered chestnut + soft lavender: along the base of the visible wall a planted row of lavender in early bloom, soft purple flowers with grey-green foliage; a vintage chestnut bench tucked against the wall beneath the window holds a folded cream linen throw and a single woven-rush basket with cut lavender stems; an aged terracotta urn at the corner with a single olive sapling; weathered limestone pavers cool under the foreground edge. Evening light with thin warm horizon band: deep navy zenith graded down through violet to a thin warm-amber band along the horizon visible beyond the corner; silhouetted cypress and olive trees in soft middle distance. The fixture is identical to the reference — modern solar-powered linear wall sconce, mounted high on the right-hand cream-stucco wall above the arched shutters, black housing with angled-up solar panel slightly catching the last evening light, the flat white opal diffuser face emitting a warm 2700-3000K wash that throws a soft pool of warm light down the cream stucco. Designer-inhabited custom residence.",
  },
  // ANGLE: FRONT-FACADE-FULL-ESTABLISHING × SCENE: L475 Italianate row of three sconces golden hour
  {
    slug: "v15_FRONT_FACADE_FULL_ESTABLISHING_italianate_row",
    prompt:
      "CAMERA ANGLE — FRONT-FACADE-FULL-ESTABLISHING: This is a whole-facade architectural shot taken from a STANDING camera position 5.5 ft off the floor across the driveway/walk from the building. The lens is WIDE 24mm focal length — full facade reads. The fixtures are dotted across the upper third of the frame as a row of three identical linear sconces mounted symmetrically along the long stucco wall; the row occupies just 5 PERCENT of the frame combined — CONTEXTUAL scale, the building is the hero and the fixtures are architectural punctuation. Camera pitch is level. Deep depth-of-field. Reference: AD architectural / facade editorial; Dazuma whole-house signature. " +
      "POOL ANCHOR (Line 475): Row of three sconces on a long stucco wall with painted-iron details + cypress in pot + Italianate — golden hour, partial moon visible. The architecture: a long Italianate facade in soft cream lime-stucco, two-story scale with delicate painted-iron details — slim black painted-iron balcony rails on the second-floor windows, a black painted-iron lantern bracket beside the entry, hand-forged iron grilles on the ground-floor windows; tall arched windows with deep reveals along the wall; a low cream-stucco garden wall along the path. ACCENT PALETTE — cream stucco + black iron + cypress green + golden tile: three slim Italian cypresses in tall aged-terracotta pots stand at evenly-spaced intervals along the wall, each marking the rhythm between sconces; a long limestone garden walk runs parallel to the facade, edged with low boxwood; gravel borders the walk; an antique iron bench against the wall midway down. Golden hour with low warm sun casting long shadows from the cypresses and the building eave: warm-gold raking light grazes the cream stucco, picking out the texture; pale-amber sky overhead grading to soft-rose at horizon; a partial moon visible high in the upper-left of the sky as a pale crescent against the warm sky. The row of three fixtures is identical to the reference — modern solar-powered linear wall sconces, mounted at even intervals high on the cream-stucco wall at standard facade height, black housings with their angled-up solar panels catching the low warm sun, flat white opal diffusers face down-and-forward not yet emitting (twilight not fully arrived). Designer-inhabited custom residence.",
  },
  // ANGLE: FACADE-LOOK-UP-FROM-WALK (custom low-look-up variant) × SCENE: L195 Dazuma craftsman single sconce
  {
    slug: "v15_FACADE_LOOK_UP_FROM_WALK_craftsman_single",
    prompt:
      "CAMERA ANGLE — FACADE-LOOK-UP-FROM-WALK: This is a LOW look-up shot taken from a LOW camera position 3 ft off the floor on the front walk, just below the porch overhang. The lens is WIDE-NORMAL 30mm focal length — slight room expansion. The fixture is positioned upper-center of the frame, mounted on the porch wall just below the deep overhang, and occupies 20 PERCENT of the frame area — DOMINANT scale, the fixture reads as architectural punctuation against the dark recessed porch ceiling. Camera pitch tilts UP 25 DEGREES so the porch overhang and the fixture dominate the upper half of the frame. Deep depth-of-field. Reference: AD editorial craftsman-porch features; Dazuma facade-look-up adaptation of OFF-CENTER-SCONCE-DAYTIME. " +
      "POOL ANCHOR (Line 195): [DAZUMA-CANONICAL] Single sconce on a craftsman bungalow with deep porch overhang + lavender + craftsman — evening, thin warm horizon band, navy zenith. The architecture: a craftsman bungalow facade with characteristic deep eave overhang supported by tapered cedar columns on stone pier bases; horizontal lap siding in soft sage-grey paint; the porch ceiling above is finished in tongue-and-groove beadboard painted soft 'haint' pale-blue; wide cedar porch steps lead up. ACCENT PALETTE — sage-grey + weathered cedar + stone + soft lavender: a planted row of lavender along the base of the porch in front of the stone piers, soft purple in evening light; a single antique-bronze house number plate on the wall beside the sconce; a hand-woven jute doormat at the threshold; a vintage galvanized planter of flowering rosemary at one side of the steps. Evening light with thin warm horizon band: deep navy zenith visible in a slice of sky to one side, graded down through violet to a thin warm-amber band along the horizon; silhouetted oak branches against the warm-fading sky beyond the eave. The fixture is identical to the reference — modern solar-powered linear wall sconce, mounted high on the sage-grey lap-siding wall just below the deep porch overhang, viewed from below so the body's chamfered black housing and angled-up solar panel both read distinctly against the pale-blue porch beadboard ceiling above. The flat white opal diffuser face emits a warm 2700-3000K wash that throws a strong pool of warm light down the wall and onto the cedar porch decking below. Designer-inhabited custom residence.",
  },
];

interface KieCreateResp { code?: number; msg?: string; data?: { taskId?: string }; }
interface KiePollResp { code?: number; msg?: string; data?: { state?: string; failMsg?: string; failCode?: string; resultJson?: string; }; }

async function kieCreateTask(prompt: string, imageUrl: string): Promise<string> {
  const token = process.env.KIE_API_KEY!;
  const res = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: KIE_MODEL, input: { prompt, image_input: [imageUrl], aspect_ratio: "1:1", resolution: RESOLUTION, output_format: "png" } }),
  });
  if (!res.ok) throw new Error(`kie createTask HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as KieCreateResp;
  if (!json.data?.taskId) throw new Error(`kie createTask no taskId: ${JSON.stringify(json).slice(0, 200)}`);
  return json.data.taskId;
}

async function kiePoll(taskId: string): Promise<Buffer> {
  const token = process.env.KIE_API_KEY!;
  const start = Date.now();
  while (Date.now() - start < KIE_TIMEOUT_MS) {
    const res = await fetch(`${KIE_POLL_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS)); continue; }
    const json = (await res.json()) as KiePollResp;
    const state = json.data?.state;
    if (state === "success") {
      const raw = json.data?.resultJson;
      if (!raw) throw new Error("kie success but no resultJson");
      const parsed = JSON.parse(raw) as { resultUrls?: string[] };
      const urls = parsed.resultUrls ?? [];
      if (urls.length === 0) throw new Error("kie resultUrls empty");
      const imgRes = await fetch(urls[0]);
      if (!imgRes.ok) throw new Error(`download HTTP ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    if (state === "fail") throw new Error(`kie failed: ${json.data?.failMsg || json.data?.failCode || "unknown"}`);
    await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
  }
  throw new Error(`kie poll timeout`);
}

async function uploadRef(localPath: string, remotePath: string): Promise<string> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(url, key, { auth: { persistSession: false } });
  const data = fs.readFileSync(localPath);
  const { error } = await client.storage.from(BUCKET).upload(remotePath, data, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data: pub } = client.storage.from(BUCKET).getPublicUrl(remotePath);
  return pub.publicUrl;
}

async function main() {
  if (!process.env.KIE_API_KEY) throw new Error("KIE_API_KEY not set");
  const outDir = path.join(os.tmpdir(), "scene", "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = Date.now();
  console.log(`Uploading reference image...`);
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v15-${path.basename(REF)}`);
  console.log(`  ${path.basename(REF)} -> ${refUrl}`);
  const toRun = SCENES.filter((s) => {
    const outPath = path.join(outDir, `${s.slug}.png`);
    if (fs.existsSync(outPath)) { console.log(`  [skip] ${s.slug}`); return false; }
    return true;
  });
  if (toRun.length === 0) { console.log("Nothing to generate."); return; }
  console.log(`\nFiring ${toRun.length} tasks at ${RESOLUTION}...`);
  const tasks = await Promise.all(toRun.map(async (s) => {
    const taskId = await kieCreateTask(GUARDRAILS + s.prompt, refUrl);
    console.log(`  [${s.slug}] ${taskId}`);
    return { s, taskId };
  }));
  console.log(`\nPolling ${tasks.length} tasks...`);
  const results = await Promise.allSettled(tasks.map(async ({ s, taskId }) => {
    const buf = await kiePoll(taskId);
    const outPath = path.join(outDir, `${s.slug}.png`);
    fs.writeFileSync(outPath, buf);
    return { s, outPath };
  }));
  console.log(`\nResults:`);
  let ok = 0, fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const slug = toRun[i].slug;
    if (r.status === "fulfilled") { console.log(`  OK   ${slug}`); ok++; }
    else { console.log(`  FAIL ${slug} -> ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`); fail++; }
  }
  console.log(`\nDone. ${ok}/${tasks.length}. Folder: ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
