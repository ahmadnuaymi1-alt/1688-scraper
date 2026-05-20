/**
 * v11 — Memphis cream-donut + red-ball flush mount, regenerated with category-weighted free angle selection.
 * Indoor-ceiling weighting: heavy = wide/3-4-left/3-4-right/depth-axis; moderate = straight-on/corner; sparing = low-up/tight.
 *
 * POOL SAMPLE: lines 152, 180, 241, 262, 379, 432
 * CAMERA ANGLES (free-selected, all different):
 *   L152 → Wide establishing
 *   L180 → Standing eye-level 3/4 right
 *   L241 → Corner two-wall composition
 *   L262 → Down-corridor depth axis
 *   L379 → Standing eye-level straight-on
 *   L432 → Standing eye-level 3/4 left
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

const REF = path.join(os.tmpdir(), "scene", "p4", "p4_2.jpg");

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — a Memphis-style compact semi-flush mount. Small round CREAM-painted aluminum canopy mounted flush to the ceiling. Suspended just beneath the canopy is a flat disc/donut-shaped shade in amber-tinted clear glass with rounded rolled edges, a frosted white acrylic diffuser disc visible in the center underside emitting warm light. A SMALL RED CERAMIC BALL ACCENT sits at the connection point between canopy and shade — the signature detail. Do NOT omit the red ball or change the amber-glass donut silhouette.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS — visible but soft: real trees, branches, hedges, pale soft sky visible. Brighter than the interior but NOT pure white blown-out. Soft natural rolloff. Exterior slightly softer than the interior. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies, painted-backdrop CGI effect.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // L152 → WIDE ESTABLISHING — Modern farmhouse dining room autumn
  {
    slug: "v11_L152_wide_farmhouse_dining_autumn",
    prompt:
      "WIDE ESTABLISHING SHOT. 28mm lens at standing eye-level (~5.5 ft), straight-on pulled back to show the full modern farmhouse dining room as the hero; fixture small in the upper center of the frame. POOL ANCHOR (Line 152): [POTTERY-BARN] Modern farmhouse dining room styled for autumn with reclaimed beams and shiplap + pumpkins-and-greenery centerpiece on farm table + modern farmhouse — autumn evening. Exposed reclaimed-oak ceiling beams cross overhead; horizontal white shiplap accent wall on the back; wide-plank quarter-sawn white-oak floor. ACCENT PALETTE — black + walnut + jute + brass: a long reclaimed-oak farm table dominates the room with six black Windsor chairs, an autumn centerpiece running down the middle — three heirloom white pumpkins of graduated sizes, brass candlesticks with ivory taper candles half-burned, magnolia branches with bronze backs, sprigs of dried hops, and a small cream stoneware pitcher of dried wheat; cream linen napkins folded with antique-brass napkin rings at each place setting; a hand-knotted jute-and-cream runner under the table; a built-in cream-painted oak hutch along the side wall displays stacked ironstone pitchers and a row of cream ceramic crocks; a brass-framed leaning English meadow oil painting against the side wall. A tall window on the right shows soft fading autumn-evening light: visible silhouetted maple branches with a few remaining warm-amber leaves against a quiet blue-grey sky, exterior soft but recognizable. The ceiling fixture is mounted above the table, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a beam, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 6% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding beams. Designer-inhabited custom residence.",
  },
  // L180 → STANDING EYE-LEVEL 3/4 RIGHT — Hamptons guest bedroom
  {
    slug: "v11_L180_3qtr_right_hamptons_guest_bedroom",
    prompt:
      "STANDING EYE-LEVEL 3/4 RIGHT. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the RIGHT of center showing two walls of a Hamptons guest bedroom at a 35° angle, framed medium. POOL ANCHOR (Line 180): [POTTERY-BARN] Guest bedroom with painted beadboard ceiling and seagrass rug + iron four-poster and linen-skirted bench + Hamptons — late afternoon summer. Painted white beadboard ceiling above with thin painted reveal trim; white-painted vertical shiplap walls; wide-plank bleached-oak floor. ACCENT PALETTE — driftwood + white linen + soft blue + brass: a black-iron four-poster bed centered against the back wall (no fabric canopy) with layered ivory linen bedding intentionally rumpled, a folded soft-blue waffle-cotton coverlet at the foot, two layered cushions in cream bouclé and slate-blue linen, and a small monogrammed navy linen lumbar; a long linen-skirted bench at the foot of the bed with a folded cream cable-knit throw and one woven straw beach hat; a small driftwood nightstand at the left holds a stoneware vessel with cream and powder-blue hydrangeas, a stack of two cream-bound coastal novels with brass bookends, a brass-rim glass tumbler, and a small brass alarm clock; a hand-woven seagrass rug grounds the bed with fine fiber texture; a brass-framed antique nautical chart leans against the side wall above a slim driftwood console. A tall window on the right wall shows soft late-afternoon summer light: visible greenery and pale-blue sky beyond with light atmospheric haze, exterior soft but recognizable, gentle bright rolloff. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the beadboard ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow on the beadboard ceiling. Designer-inhabited custom residence.",
  },
  // L241 → CORNER TWO-WALL COMPOSITION — Mountain lodge bedroom winter
  {
    slug: "v11_L241_corner_two_wall_mountain_lodge_bedroom_winter",
    prompt:
      "CORNER TWO-WALL COMPOSITION. 35mm lens at standing eye-level (~5.5 ft), camera positioned in a corner of the bedroom showing two adjacent walls — the stone hearth wall on the right and the bed wall on the left — at a 45° angle, framed medium. POOL ANCHOR (Line 241): Mountain modern lodge bedroom with stone-clad hearth and timber-truss ceiling + chunky wool throw and reclaimed-oak nightstand + mountain lodge — late evening winter. A stacked dry-stone hearth dominates the right wall with a low oil-rubbed-bronze fireplace opening showing a soft warm internal glow; a timber-truss ceiling rises overhead with reclaimed oak beams; wide-plank quarter-sawn oak floor; the bed wall on the left shows a king bed with a reclaimed-oak headboard. ACCENT PALETTE — charcoal + cognac + brass + cream cable knit: layered ivory linen bedding intentionally rumpled, a chunky cream cable-knit throw folded across the foot, a charcoal wool plaid blanket draped over one side, two layered cushions in cognac saddle-leather and cream sherpa; a reclaimed-oak nightstand visible at the bed-corner holds a stoneware vessel with a single sprig of cedar, a stack of two cognac-leather-bound novels with brass bookends, a brass-banded alarm clock, and a half-burned cream beeswax taper in a brass holder; a cognac-leather slipper chair beside the hearth with a folded charcoal wool throw and a hand-knotted heritage Persian rug in charcoal-and-cream grounding the seating; a brass-framed leaning vintage mountain landscape oil painting against the stone wall. Warm-dimmed brass-housed recessed cans glow at the truss junctions; the fixture is the dominant ceiling light in the room. The ceiling fixture is mounted overhead at the corner-ceiling intersection, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a beam panel, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 10% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding timber. Designer-inhabited custom residence.",
  },
  // L262 → DOWN-CORRIDOR DEPTH AXIS — Pacific Coastal hallway summer
  {
    slug: "v11_L262_down_corridor_depth_pacific_coastal_hallway_summer",
    prompt:
      "DOWN-CORRIDOR DEPTH AXIS SHOT. 28mm lens at standing eye-level (~5.5 ft), camera positioned at the start of the hallway looking straight down its length toward a far cased doorway. The corridor architecture pulls the eye into the depth. POOL ANCHOR (Line 262): Pacific Coastal hallway with whitewashed planked ceiling and seagrass runner + driftwood console and abalone shells + Pacific Coastal — morning summer. Whitewashed tongue-and-groove planked ceiling runs the full length above with thin painted ridge beams; vertical shiplap walls in soft warm white; wide-plank bleached-oak floor stretches into the depth. ACCENT PALETTE — driftwood + white linen + soft blue + brass: a hand-woven seagrass runner runs the length of the corridor with fine fiber texture and subtle wear; a vintage driftwood-grey console along the right wall midway down holds a curated collection of three abalone shells displayed on a small antique-brass tray, a stoneware vessel with cream and powder-blue hydrangeas, a stack of two cream-bound coastal monographs with brass bookends, a brass-rim glass jar of bleached driftwood pieces, and a single conch shell; a leaning brass-rim antique nautical chart against the wall above; a small cream-painted Windsor chair tucked against the far wall with a folded cream cable-knit throw; a woven straw market basket beside the chair. The far doorway frames a glimpse of soft morning summer daylight beyond: visible green trees and pale-blue sky with light atmospheric haze, exterior soft but recognizable. The ceiling fixture is mounted overhead near the middle of the corridor, occupying the mid-ground of the frame, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the plank ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the planked ceiling. Designer-inhabited custom residence.",
  },
  // L379 → STANDING EYE-LEVEL STRAIGHT-ON — Glass kitchen pavilion blue hour
  {
    slug: "v11_L379_straight_on_glass_kitchen_pavilion_blue_hour",
    prompt:
      "STANDING EYE-LEVEL STRAIGHT-ON SHOT. 35mm lens at standing eye-level (~5.5 ft), dead-on perpendicular framing of the kitchen island as the focal element, fixture centered above. POOL ANCHOR (Line 379): [DAZUMA-CANONICAL] Glass-walled modern kitchen pavilion with cantilevered roof and travertine floor + sculptural island and bronze accents + contemporary — blue hour summer. A cantilevered cream-painted roof plane rises overhead with thin recessed lighting strips at its perimeter; floor-to-ceiling steel-mullioned glass walls flank the room; honed-travertine tile floor with grouted joints. ACCENT PALETTE — charcoal + brass + olive + linen: a sculptural honed-travertine waterfall kitchen island dominates the foreground with bronze drawer pulls; on the island, a brass-handled stoneware pitcher of olive branches, a wooden cutting board with a half-loaf of seeded bread and a brass-handled bread knife, a cream linen tea towel folded loosely, a small olive ceramic bowl of citrus, a stack of two cream-bound culinary monographs spine-out, and an antique-brass salt cellar; three slim charcoal-linen counter stools tucked under one side; cream-painted Shaker cabinets along the back wall behind the island with brass cup pulls and a marble backsplash; a brass-and-steel range hood. Floor-to-ceiling steel-mullioned glass walls reveal soft blue-hour summer light beyond: visible silhouetted trees against a deep navy sky graded to violet at horizon with a thin warm band of last light, exterior soft and atmospheric. Warm-dimmed recessed lighting strips along the roof perimeter glow softly. The ceiling fixture is mounted above the island, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the cream roof plane, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor of the blue-hour interior. Designer-inhabited custom residence.",
  },
  // L432 → STANDING EYE-LEVEL 3/4 LEFT — Mediterranean garden room spring morning
  {
    slug: "v11_L432_3qtr_left_mediterranean_garden_room_spring",
    prompt:
      "STANDING EYE-LEVEL 3/4 LEFT. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the LEFT of center showing two walls of a Mediterranean garden room at a 35° angle, framed medium. POOL ANCHOR (Line 432): Garden room with terracotta pots and iron-and-glass ceiling + caned conservatory chairs and citrus topiary + Mediterranean — morning spring. A vaulted iron-and-glass ceiling rises overhead with thin white-painted iron mullions; rough whitewashed plaster walls; checkerboard limestone-and-terracotta tile floor. ACCENT PALETTE — terracotta + cream + brass + olive: two caned conservatory chairs in cream rattan with cream linen seat cushions face each other across a small round bleached-oak side table; on the table, a brass-handled ceramic pitcher of fresh-cut wildflowers, a cream linen napkin folded loosely, an open hardcover gardening monograph face-down with a sprig of olive as a bookmark, and a small terracotta dish with citrus peels; two large terracotta-glaze planters with mature citrus topiary trees flank the chairs; smaller terracotta pots along a low built-in stone planter hold mature olive saplings and ornamental herbs; rows of leafy herbs in cream pots line a long built-in stone planter at the base of the glass wall on the side; a brass-and-rattan watering can leans against a pot; a hand-woven jute-and-cream rug under the chairs with fine fiber texture. Floor-to-ceiling steel-and-glass walls reveal soft morning spring light beyond: visible green trees and pale-blue sky with light atmospheric haze, blooming pale-pink camellia branches against the glass, exterior soft and recognizable. The ceiling fixture is mounted at a beam intersection of the glass roof overhead, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a beam, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 7% of the frame. Switched ON, soft warm 2700-3000K accent within the bright morning light. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v11-${path.basename(REF)}`);
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
