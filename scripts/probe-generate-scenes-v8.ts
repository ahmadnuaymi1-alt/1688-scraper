/**
 * v8 — strict-pool-sampling test for crystal semi-flush (brushed brass).
 *
 * TRANSPARENCY BLOCK:
 *   POOL SAMPLE: lines 212, 354, 400, 464, 469, 471 (re-sampled once)
 *   SCENES (verbatim from pools/indoor-ceiling.md):
 *     - L212: Spanish hacienda bedroom — Spanish revival — golden hour autumn
 *     - L354: Scullery off main kitchen — modern farmhouse — morning autumn
 *     - L400: Coastal sunporch kitchen — Pacific Coastal — midday summer
 *     - L464: Pantry / larder — traditional — morning autumn
 *     - L469: Reading nook with bay window — Hamptons — late afternoon summer
 *     - L471: Dressing room island — traditional — late evening
 *   CAMERA ASSIGNMENT:
 *     - L212 → T2 (3/4 LEFT)
 *     - L354 → T3 (3/4 RIGHT)
 *     - L400 → T5 (LOW ANGLE UP)
 *     - L464 → T4 (DEPTH-AXIS)
 *     - L469 → T6 (TIGHT VIGNETTE)
 *     - L471 → T1 (WIDE ESTABLISHING)
 *   CONSTRAINT: 0 obvious / 6 less-obvious / all suit ceiling fixture ✓
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

const REF = path.join(os.tmpdir(), "scene", "ref5.jpg"); // brushed-brass crystal square semi-flush

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — a compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the ceiling, one E27 bulb visible inside.

ONE SINGLE 1:1 photograph. No collage, grid, mood board. ZERO Mandarin / Chinese / Asian characters. No app chrome. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS: if a window is visible, exterior must be SOFT, DIFFUSE, UNDEREMPHASIZED — sheer curtains filtering daylight, slight overexposure, glimpse of out-of-focus greenery, or silhouetted branches. Do NOT render dramatic clouds, vivid skies, sunset gradients, or detailed moon-and-stars through interior windows.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // L212 → T2 — Spanish hacienda bedroom, terracotta+cream+brass+olive palette
  {
    slug: "v8_L212_T2_spanish_hacienda_bedroom_3qtr_left_terracotta",
    prompt:
      "TREATMENT 2 — STRONG 3/4 LEFT ANGLE. 35mm lens at standing eye-level, camera positioned to the LEFT of center showing two walls of a Spanish hacienda bedroom at a 35° angle, framed medium. POOL ANCHOR (Line 212): Spanish hacienda bedroom with vigas-and-latillas ceiling and saltillo floor + carved walnut bed and woven blanket + Spanish revival — golden hour autumn. Exposed reclaimed-oak vigas-and-latillas ceiling rises overhead; rough whitewashed plaster walls; terracotta saltillo tile floor with grouted joints. ACCENT PALETTE — terracotta + cream + brass + olive: a carved walnut four-poster bed against the back wall with layered linen bedding in cream and ivory intentionally rumpled (not made, not messy); a heritage hand-loomed wool blanket in terracotta-and-cream stripes folded across the foot of the bed; a small ceramic bowl of stone-fruit on the duvet; a vintage walnut nightstand at left holds a cream stoneware vessel with three sprigs of olive, a stack of two leather-bound cream poetry books with brass bookends, a half-burned cream beeswax taper in an antique-brass holder, and a brass alarm clock; a cognac-leather Spanish cross-back chair tucked in the corner with a folded cream wool throw; a terracotta-and-cream hand-knotted Persian rug on the saltillo with fine pile; a brass-framed antique gilt mirror leans against the side wall above a small walnut credenza. A small arched window on the right wall in deep-set wood casing shows soft golden-hour autumn light, exterior reading as out-of-focus warm foliage with no specific cloud detail. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the wood-beam ceiling, one E27 bulb visible. Occupies roughly 11% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. Designer-inhabited custom residence.",
  },
  // L354 → T3 — Scullery off main kitchen, black+walnut+jute+brass (modern farmhouse)
  {
    slug: "v8_L354_T3_scullery_3qtr_right_modern_farmhouse_black_walnut_jute",
    prompt:
      "TREATMENT 3 — STRONG 3/4 RIGHT ANGLE. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the RIGHT of center showing two walls of a scullery off the main kitchen at a 35° angle, framed medium. POOL ANCHOR (Line 354): Scullery off main kitchen with shiplap walls and slate floor + open shelving and stoneware + modern farmhouse — morning autumn. Vertical white shiplap walls; a slate-tile floor with grouted joints; the back wall lined with open walnut shelves holding cream ironstone pitchers, dark stoneware crocks, and stacked white ceramic dinnerware; a soapstone counter runs along the right wall with a matte-black gooseneck faucet over a fireclay apron-front sink. ACCENT PALETTE — black + walnut + jute + brass: a hand-woven jute runner along the slate floor showing fine wear; a black-painted Windsor chair tucked at the right with a folded cream waffle-knit throw over its back; on the counter, a brass-bound wood cutting board with a half-loaf of crusty bread, a stoneware crock of wooden utensils, a cream linen tea towel embroidered with a small black monogram, a black cast-iron mortar and pestle, and a stack of two cream-bound recipe books with brass bookends; on a walnut shelf above the counter, a brass-rim glass canister of dried bay leaves and a small black ceramic vase with a single dried wheat sprig; a brass house-number plate on the wall beside the doorway to the kitchen; warm-dimmed brass-housed recessed cans glow in the shiplap ceiling. A small window above the sink shows softly diffused morning autumn light through sheer cream curtains, exterior reading as out-of-focus warm foliage with no specific cloud detail. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the shiplap ceiling, one E27 bulb visible. Occupies roughly 10% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. Designer-inhabited custom residence.",
  },
  // L400 → T5 — Coastal sunporch kitchen, bleached oak + burlap + jute + monogrammed navy (Pacific Coastal)
  {
    slug: "v8_L400_T5_coastal_sunporch_kitchen_low_angle_up_pacific_coastal",
    prompt:
      "TREATMENT 5 — LOW ANGLE LOOKING UP. 35mm lens at LOW height (~3.5 ft off the floor), camera tilted up 15° toward the fixture and the ceiling. POOL ANCHOR (Line 400): Coastal sunporch kitchen with whitewashed tongue-and-groove ceiling and seagrass rug + rattan stools and conch shell + Pacific Coastal — midday summer. The upper portion of the frame is dominated by a whitewashed tongue-and-groove plank ceiling with thin white-painted beams; the lower portion catches the top of a bleached-oak kitchen island with three woven rattan counter stools at it. ACCENT PALETTE — bleached oak + burlap + jute + monogrammed navy: on the bleached-oak island top, a stack of two cream linen napkins with embroidered navy monograms in a small antique-brass tray, a navy ceramic pitcher of yellow-and-cream wildflowers, a brass-rim glass cake-stand with a half-cut peach pie, a small wooden cutting board with a brass-handled cake server, and a stoneware bowl of stone-fruit; the conch shell rests on a small jute-wrapped tray at the edge; a folded burlap-and-navy striped runner on the bleached-oak floor; a seagrass rug edge visible at the lower corner; brass-handled cane-fronted cabinets are visible behind the stools. A small bay window beyond the island is slightly overexposed with diffused midday summer light, exterior reading as out-of-focus pale-blue sky and soft green foliage, no specific cloud detail. The ceiling fixture is mounted overhead above the island, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the plank ceiling, one E27 bulb visible. Occupies roughly 22% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding plank ceiling. The fixture earns its prominence in the upward angle. Designer-inhabited custom residence.",
  },
  // L464 → T4 — Pantry / larder, cinnamon+cream+rust+pink (grand-millennial neutral fall)
  {
    slug: "v8_L464_T4_pantry_larder_depth_axis_cinnamon_cream",
    prompt:
      "TREATMENT 4 — DEPTH-AXIS SHOT. 28mm lens at standing eye-level (~5.5 ft), camera positioned at the threshold of the main kitchen looking through the cased opening down a depth axis into a pantry / larder beyond. The cased opening frames the foreground; a tray ceiling rises overhead in the pantry; open walnut shelves rise along both side walls. POOL ANCHOR (Line 464): Pantry / larder with open shelving and marble counter + stoneware jars and woven baskets + traditional — morning autumn. ACCENT PALETTE — cinnamon velvet + cream linen + rust quilted velvet + dusty pink: a honed-marble counter runs the back wall of the pantry; on the shelves, a row of graduated cream stoneware jars labeled in cinnamon-painted brass tags, a stack of three cream linen tea towels, woven natural baskets, a tall rust-glazed ceramic pitcher with a single bunch of dried wheat, brass-rim glass apothecary jars of dried-lavender and pink-peppercorn, a small cinnamon-velvet round stool tucked under the counter, a brass-bound recipe book stack with a folded dusty-pink linen napkin draped across it; a small framed botanical of a dried wheat sheaf in a brass frame leans against one shelf; a pale-pink-and-cinnamon Persian runner on the herringbone wood floor with fine pile and visible wear; the kitchen visible in the foreground shows a corner of a marble waterfall island with a vase of pink peonies. A small clerestory window in the pantry shows softly diffused morning autumn light, exterior reading as soft warm foliage out-of-focus with no specific cloud detail. The ceiling fixture is mounted overhead in the pantry, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the tray ceiling, one E27 bulb visible. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor. Designer-inhabited custom residence.",
  },
  // L469 → T6 — Reading nook with bay window, driftwood+white linen+soft blue+brass (Hamptons coastal)
  {
    slug: "v8_L469_T6_reading_nook_bay_tight_vignette_hamptons_driftwood_softblue",
    prompt:
      "TREATMENT 6 — TIGHT VIGNETTE / DETAIL ANGLE. 50mm lens at slightly elevated eye-level (~6 ft), camera tilted slightly down toward a styled reading nook corner, framed tight. Compressed perspective; less of the room, more of the bay-window alcove and chair vignette. POOL ANCHOR (Line 469): Reading nook with bay window and painted beadboard ceiling + slipcovered chair and stack of summer reads + Hamptons — late afternoon summer. A painted white beadboard ceiling above; the three-panel bay window dressed in sheer white linen drapes; whitewashed driftwood-look wide-plank floor visible at the lower edge. ACCENT PALETTE — driftwood + white linen + soft blue + brass: a slipcovered cream linen wingback chair tucked into the bay with a folded soft-blue waffle-cotton throw casually draped over one arm; a stack of two summer-reading hardcovers with sun-bleached cream covers and one slim soft-blue novel on a small driftwood side table, a pair of round wire-rim reading glasses laid on the open top book; a slim brass library lamp (switched off, decorative) beside the books; a small brass-rim glass pitcher of white-and-soft-blue hydrangeas on the windowsill; a single conch shell on the sill beside it; a hand-woven jute-and-driftwood-toned runner under the chair with fine fiber texture; a brass-framed small framed coastal watercolor sketch leans against the side wall. The bay window's three panels are slightly overexposed with diffused late-afternoon summer light, exterior reading as out-of-focus pale-blue sky and soft greenery — no specific cloud detail. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the beadboard ceiling, one E27 bulb visible. Occupies roughly 16% of the frame. Switched ON, soft warm 2700-3000K glow on the cream beadboard ceiling. The fixture's prominence is appropriate to the tight crop. Designer-inhabited custom residence.",
  },
  // L471 → T1 — Dressing room island, plum+cream+brass+pink florals
  {
    slug: "v8_L471_T1_dressing_room_island_wide_establishing_plum_cream",
    prompt:
      "TREATMENT 1 — WIDE ESTABLISHING SHOT. 28mm lens at standing eye-level (~5.5 ft), straight-on framing pulled back to show the full dressing room with the center island as the hero; fixture small in the upper portion of the frame. POOL ANCHOR (Line 471): Dressing room island with marble counter and brass hardware + velvet pouf and crystal trays + traditional — late evening. The room is the hero; a coffered ceiling overhead in soft warm white; built-in cream-painted oak cabinetry rises the full height of the back wall, louvered doors with brass cup pulls; a center honed-marble island with brushed-brass legs dominates the room; herringbone walnut floor stretches across the room. ACCENT PALETTE — plum + cream + brass + soft pink florals: on the marble island, a small plum-velvet jewelry pouf with brass-rim crystal trays of earrings and stacked bangles, a brass-handled ceramic vessel of fresh pale-pink peonies, a vintage cream-leather perfume tray with three crystal flacons, a stack of three folded plum cashmere wraps on one corner, a small antique-brass hand mirror laid face-down beside the perfume tray; the back wall's louvered doors are slightly ajar revealing folded cream linen shirts with plum-bound hangers; a long plum-velvet bench tucked against the right wall with a folded cream cashmere wrap and one cream waffle-weave robe draped over its arm; a brass-trimmed full-length mirror leans against the side wall; a hand-knotted plum-and-cream Persian rug under the island with visible pile and fine wear; warm-dimmed brass-housed recessed cans glow in the coffered ceiling. The ceiling fixture is centered above the island, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the coffered ceiling, one E27 bulb visible. Occupies roughly 6% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor of the late-evening interior. The fixture is sized to anchor without dominating; the cabinetry and island lead the eye. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v8-${path.basename(REF)}`);
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
