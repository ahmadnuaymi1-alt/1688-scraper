/**
 * v10 — Memphis-style semi-flush mount (cream canopy + amber-tinted glass donut shade + small red ball accent).
 *
 * POOL SAMPLE: lines 17, 41, 42, 98, 151, 313 (passed first attempt; 1 obvious within cap)
 * CAMERA ASSIGNMENT:
 *   L17  → T3 (3/4 RIGHT)        | Conservatory living room
 *   L41  → T1 (WIDE)              | Pacific Coastal pavilion
 *   L42  → T4 (DEPTH-AXIS)        | Library-living hybrid [POTTERY-BARN]
 *   L98  → T2 (3/4 LEFT)          | Glass pavilion living wing [DAZUMA-CANONICAL]
 *   L151 → T6 (TIGHT VIGNETTE)    | Tudor great-hall dining room
 *   L313 → T5 (LOW ANGLE UP)      | French country entry
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

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — a Memphis-style compact semi-flush mount. A small round CREAM-painted aluminum canopy mounted flush to the ceiling. Suspended just beneath the canopy is a flat disc/donut-shaped shade in amber-tinted clear glass with rounded rolled edges, a frosted white acrylic diffuser disc visible in the center underside emitting warm light. A SMALL RED CERAMIC BALL ACCENT sits at the connection point between canopy and shade — the signature detail. Do NOT change the silhouette, the amber-glass donut form, the cream canopy, or omit the red ball.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS — visible but soft: real trees, branches, hedges, pale soft sky visible. Brighter than the interior, but NOT pure white blown-out. Soft natural rolloff. Exterior detail slightly softer than the interior. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies, painted-backdrop CGI effect.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // L17 → T3 — Conservatory living room, morning spring
  {
    slug: "v10_L17_T3_conservatory_living_room_3qtr_right_morning_spring",
    prompt:
      "TREATMENT 3 — STRONG 3/4 RIGHT ANGLE. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the RIGHT of center showing two walls of a conservatory living room at a 35° angle, framed medium. POOL ANCHOR (Line 17): Conservatory living room with cast-iron mullioned glass roof and brick floor + wicker peacock chairs and ferns + English country — morning spring. A vaulted glass roof with black cast-iron mullions rises overhead with thin white-painted ridge beams; reclaimed-brick herringbone floor underfoot; floor-to-ceiling steel-and-glass walls reveal a clear pale-blue spring morning sky beyond with visible green trees and a hedge of blooming white camellia, light atmospheric haze, soft natural rolloff into the room. ACCENT PALETTE — sage green + cream + brass + soft pink florals: two oversized wicker peacock chairs face each other with cream linen cushions and folded sage-green wool throws draped over their arms; a low round walnut coffee table between them holds a stack of two cream-bound garden monographs spine-out, a brass-handled ceramic pitcher of soft-pink garden roses and silver-dollar eucalyptus, a stoneware ramekin of pruning shears, and a half-burned cream beeswax taper in an antique-brass holder; a large potted Boston fern on a brass-and-rattan plant stand at the corner; a smaller Maidenhair fern on a small brick-and-brass side table; a small framed botanical of a fern in a brass frame leaning against the brick wall; a worn-in cream-and-sage jute-and-cotton rug atop the herringbone brick with fine fiber texture. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a beam intersection of the glass roof, flat amber-glass donut shade suspended just beneath, frosted white diffuser disc visible underneath, small RED CERAMIC BALL accent at the canopy-shade connection. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding plaster ceiling beams. Designer-inhabited custom residence.",
  },
  // L41 → T1 — Pacific Coastal pavilion, blue hour
  {
    slug: "v10_L41_T1_pacific_coastal_pavilion_wide_blue_hour",
    prompt:
      "TREATMENT 1 — WIDE ESTABLISHING SHOT. 28mm lens at standing eye-level (~5.5 ft), straight-on framing pulled back to show the full Pacific Coastal pavilion as the hero; fixture small in the upper portion of the frame. POOL ANCHOR (Line 41): Pacific Coastal pavilion with weathered shiplap ceiling and limestone floor + ivory wool sectional and abalone shell collection + Pacific Coastal — blue hour. A weathered whitewashed shiplap ceiling rises overhead with exposed thin painted beams; pale honey limestone tile floor; floor-to-ceiling steel-mullioned glass walls reveal a soft fading dusk light beyond, visible silhouetted pine trees against a quiet violet-blue evening sky with subtle warm horizon haze, exterior visible but muted. ACCENT PALETTE — bleached oak + driftwood + soft blue + brass: an oversized ivory wool sectional sofa anchors the room with a folded soft-blue waffle-cotton throw casually draped over one arm, two layered cushions in cream bouclé and slate-blue linen; a low bleached-oak coffee table holds a curated collection of three abalone shells displayed on a small antique-brass tray, a stack of two cream-bound coastal-design monographs spine-out, a slim glass jar of bleached driftwood pieces, and a single conch shell; a slim driftwood-grey rattan armchair to one side with a folded cream cable-knit throw; a hand-knotted soft-blue-and-cream jute rug grounds the seating; a brass-framed antique gilt mirror leans against the side wall; a slim bleached-oak credenza along the back holds a small ironstone pitcher of cream hydrangeas. Warm-dimmed brass-housed recessed cans glow softly in the ceiling beams. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the shiplap ceiling, flat amber-glass donut shade suspended just beneath, frosted white diffuser disc visible underneath, small RED CERAMIC BALL accent at the canopy-shade connection. Occupies roughly 6% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor of the blue-hour interior. Sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  // L42 → T4 — Library-living hybrid, late evening autumn
  {
    slug: "v10_L42_T4_library_living_hybrid_depth_axis_late_evening_autumn",
    prompt:
      "TREATMENT 4 — DEPTH-AXIS SHOT. 28mm lens at standing eye-level (~5.5 ft), camera positioned at the threshold of the adjacent hallway looking through the cased opening into the library-living hybrid beyond. The cased oak doorway frames the foreground; picture-rail molding runs the upper walls of the library beyond; built-in oak bookshelves rise floor to ceiling along the back wall, dense with leather-bound books in tobacco, ochre, and forest green. POOL ANCHOR (Line 42): [POTTERY-BARN] Library-living hybrid with picture-rail molding and built-in oak shelves + button-back wingbacks and brass library lamps + English country — late evening autumn. ACCENT PALETTE — forest green + cognac + brass + cream: two button-back wingback chairs in deep forest-green velvet face each other across a low oak coffee table; a brass library lamp (switched off, decorative) on a slim brass standard between them; on the coffee table, a stack of three cream-bound classics with brass bookends, a small cognac-leather notebook with a brass-and-tortoise pen laid on the open page, a brass-rim stoneware mug, a folded cream cable-knit throw across one wingback arm, and a small forest-green ceramic vessel with a single sprig of dried bittersweet; a hand-knotted forest-green-and-cream Persian rug on the herringbone walnut floor; a brass-framed leaning antique English landscape oil painting against the bookshelf base; warm-dimmed brass cove lighting glows behind a top crown moulding. A tall window beyond the chairs shows soft fading late-evening autumn light: visible silhouetted maple branches with a few remaining warm-amber leaves against a quiet blue-grey evening sky with subtle color, exterior soft but recognizable. The ceiling fixture is mounted overhead in the library, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the ceiling, flat amber-glass donut shade suspended just beneath, frosted white diffuser disc visible underneath, small RED CERAMIC BALL accent at the canopy-shade connection. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the picture-rail molding. Designer-inhabited custom residence.",
  },
  // L98 → T2 — Glass pavilion living wing, blue hour autumn
  {
    slug: "v10_L98_T2_glass_pavilion_living_wing_3qtr_left_blue_hour_autumn",
    prompt:
      "TREATMENT 2 — STRONG 3/4 LEFT ANGLE. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the LEFT of center showing two walls of a contemporary glass pavilion living wing at a 35° angle, framed medium. POOL ANCHOR (Line 98): [DAZUMA-CANONICAL] Glass pavilion living wing with floating roof plane and walnut floor + sculptural marble coffee table and oversized abstract painting + contemporary — blue hour autumn. A floating cantilevered roof plane in soft warm cream stretches overhead with thin recessed lighting strips at its perimeter; floor-to-ceiling steel-mullioned glass walls reveal a soft blue-hour autumn exterior, visible silhouetted maple trees with a few remaining warm-amber leaves against a deep navy evening sky graded to violet at horizon, exterior soft but visible. ACCENT PALETTE — charcoal + brass + olive + linen: a low charcoal linen sectional anchors the room with two scattered layered cushions in olive velvet and ivory bouclé and a folded charcoal wool throw casually draped over one arm; a sculptural honed-marble coffee table dominates the floor with a stack of three cream-bound art monographs spine-out, a single olive branch in a brass-rim stoneware vessel, a small antique-brass tray with two travertine coasters, and a folded linen napkin; an oversized abstract painting in charcoal-olive-cream tones hangs on the side wall in a slim brass frame; a wide-plank quarter-sawn walnut floor stretches across the wing; a hand-knotted olive-and-cream wool rug under the sectional with fine pile and visible wear; a slim brass-and-walnut floor lamp (switched off, decorative) beside the sectional; warm-dimmed recessed lighting strips along the roof perimeter glow softly. The ceiling fixture is mounted overhead, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the floating roof plane, flat amber-glass donut shade suspended just beneath, frosted white diffuser disc visible underneath, small RED CERAMIC BALL accent at the canopy-shade connection. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the cream ceiling. Designer-inhabited custom residence.",
  },
  // L151 → T6 — Tudor great-hall dining room, late evening winter
  {
    slug: "v10_L151_T6_tudor_great_hall_dining_tight_vignette_late_evening_winter",
    prompt:
      "TREATMENT 6 — TIGHT VIGNETTE / DETAIL ANGLE. 50mm lens at slightly elevated eye-level (~6 ft), camera tilted slightly down toward a styled corner of a Tudor great-hall dining room. Compressed perspective; the corner of the long oak refectory table, two Jacobean carved chairs, and the wall vignette dominate the frame. POOL ANCHOR (Line 151): Tudor great-hall dining room with hammer-beam ceiling and leaded windows + long oak refectory and Jacobean carved chairs + Tudor — late evening winter. Exposed dark-stained oak hammer-beam ceiling visible at the upper edge of the frame; rough stone walls; the corner of a leaded-glass casement window shows soft fading late-evening winter light, visible bare branches silhouetted against a quiet blue-grey sky, exterior soft and quiet. ACCENT PALETTE — burgundy + cream + brass + forest green: the end of a long oak refectory table dressed for a winter family supper with two cream linen placemats, two ironstone soup bowls steaming, two cream linen napkins folded with antique-brass napkin rings, a brass-handled stoneware bread basket of crusty bread, an antique-brass candelabra with three ivory tapers half-burned, a small forest-green ceramic vessel with a sprig of cedar and bittersweet, and a small brass salt cellar; two Jacobean carved oak chairs at the corner with cream-and-burgundy linen seat cushions; a folded burgundy wool throw draped over the corner of one chair; a small framed antique English oil landscape leans against the stone wall behind; a hand-knotted heritage burgundy-and-cream Persian runner under the table with fine pile and visible wear. Warm-dimmed brass-housed candle-style sconces flank the wall behind the table. The ceiling fixture is mounted above the table corner, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a beam intersection of the hammer-beam ceiling, flat amber-glass donut shade suspended just beneath, frosted white diffuser disc visible underneath, small RED CERAMIC BALL accent at the canopy-shade connection. Occupies roughly 15% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding timber. Designer-inhabited custom residence.",
  },
  // L313 → T5 — French country entry, afternoon spring
  {
    slug: "v10_L313_T5_french_country_entry_low_angle_up_afternoon_spring",
    prompt:
      "TREATMENT 5 — LOW ANGLE LOOKING UP. 35mm lens at LOW height (~3.5 ft off the floor), camera tilted up 15° toward the fixture and the limewashed beams overhead in a French country entry. POOL ANCHOR (Line 313): French country entry with limewashed beams and limestone floor + zinc-topped console and antique faience platter + French country — afternoon spring. Exposed lime-washed wooden beams dominate the upper portion of the frame against rough whitewashed plaster between them; the lower portion catches the top edge of a zinc-topped vintage walnut console and a sliver of pale-gold limestone tile at the lower right. ACCENT PALETTE — soft pink + cream + brass + sage: on the zinc-topped console the upper portion of an antique blue-and-cream French faience platter leaning against the wall, the top of an oversized cream ceramic urn of fresh pale-pink garden roses with sprigs of sage botanical foliage, a brass candleholder with a half-burned cream beeswax taper, a brass-framed antique gilt mirror leaning against the wall above the console reflecting the fixture and a slice of the beams; a small framed antique botanical of a pink garden rose hangs above the mirror; a brass-housed candle-style wall sconce flanks the mirror on one side, its warm glow visible. A small dormer window high on the back wall shows soft afternoon spring daylight: visible green hedge of blooming lilac and pale-blue sky beyond with light atmospheric haze, exterior soft but recognizable, gentle bright rolloff. The ceiling fixture fills the upper portion of the frame, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a plaster panel between beams, flat amber-glass donut shade suspended just beneath, frosted white diffuser disc visible underneath, small RED CERAMIC BALL accent at the canopy-shade connection. Occupies roughly 20% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding beams. The fixture earns its prominence in the upward angle. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v10-${path.basename(REF)}`);
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
