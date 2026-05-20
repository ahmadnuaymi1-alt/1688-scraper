/**
 * v12 — Memphis cream-donut + red-ball flush mount, with camera height + lens variety enforcement.
 *
 * POOL SAMPLE: lines 23, 99, 156, 359, 395, 465
 * CAMERA SETUP:
 *   L23  → 3/4 LEFT,        LOW,       50mm NORMAL          | Belgian-modern sitting room, blue hour winter
 *   L99  → WIDE,             STANDING,  28mm WIDE            | Scandinavian summer cottage, late afternoon
 *   L156 → CORNER 2-WALL,    ELEVATED,  35mm NORMAL-WIDE     | Modern Japandi dining, overcast morning
 *   L359 → DOWN-CORRIDOR,    STANDING,  24mm WIDE            | Galley kitchen, morning summer
 *   L395 → STRAIGHT-ON,      STANDING,  85mm SHORT TELE      | Cliffside kitchen pavilion, blue hour summer
 *   L465 → 3/4 RIGHT,        LOW,       50mm NORMAL          | Home office, overcast spring
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

INTERIOR WINDOWS — visible but soft: real trees, branches, hedges, pale soft sky visible. Brighter than the interior but NOT pure white blown-out. Soft natural rolloff. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // L23 → 3/4 LEFT, LOW, 50mm NORMAL — Belgian-modern sitting room blue hour winter
  {
    slug: "v12_L23_3qtr_left_LOW_50mm_belgian_sitting_room_blue_hour",
    prompt:
      "STANDING EYE-LEVEL 3/4 LEFT, LOW camera height (~3 ft off the floor — chair height), 50mm NORMAL lens — natural human-eye perspective, no distortion, intimate but not compressed. Camera positioned to the LEFT of center showing two walls of a Belgian-modern sitting room at a 35° angle. POOL ANCHOR (Line 23): Belgian-modern sitting room with limewashed plaster walls and bleached oak beams + sand-toned linen seating + Belgian — blue hour winter. Rough limewashed plaster walls with hand-troweled texture; exposed bleached-oak beams overhead; wide-plank natural-oak floor. ACCENT PALETTE — sand + cream + brass + soft sage: a deep oversized sand-linen sofa anchors the foreground in the lower part of the frame with two layered cushions in cream bouclé and faded soft-sage linen and a folded cream wool throw casually draped over one arm; a low round bleached-oak coffee table in front holds a half-burned cream beeswax taper in an antique-brass holder, a small soft-sage stoneware vessel with three sprigs of olive, a stack of two cream-bound design monographs spine-out, and a brass-rim ceramic mug; a slim sand-linen slipper chair tucked at right with a folded cream wool throw; a hand-knotted heritage sand-and-cream wool rug with fine pile and visible wear under the seating; a brass-framed leaning Belgian landscape pencil sketch against the side wall; a vintage brass standard lamp (switched off) beside the sofa. A tall window beyond the sofa shows soft fading blue-hour winter light: silhouetted bare branches against a quiet violet-grey evening sky with subtle warm horizon band, exterior visible but muted. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to a beam panel, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding limewashed plaster. Designer-inhabited custom residence.",
  },
  // L99 → WIDE establishing, STANDING, 28mm WIDE — Scandinavian summer cottage living room
  {
    slug: "v12_L99_wide_STANDING_28mm_scandi_summer_cottage_late_afternoon",
    prompt:
      "WIDE ESTABLISHING SHOT, STANDING eye-level (~5.5 ft), 28mm WIDE-ANGLE lens — slight depth expansion, expansive room feel. Straight-on framing pulled back to show the full Scandinavian summer cottage living room as the hero; fixture small in the upper portion of the frame. POOL ANCHOR (Line 99): Scandinavian summer cottage living room with painted beadboard ceiling and pine plank floor + slipcovered linen sofa and birch branch arrangement + Scandinavian — late afternoon summer. Painted white beadboard ceiling above with thin painted exposed beams; whitewashed pine plank floor stretches across the room. ACCENT PALETTE — bleached birch + cream + soft blue + brass: an oversized slipcovered ivory linen sofa anchors the room with two layered cushions in cream waffle-cotton and soft-blue ticking stripe and a folded cream cable-knit throw draped over one arm; a low round bleached-birch coffee table holds a tall white stoneware pitcher of birch branches, a stack of two cream-bound Nordic-design monographs spine-out, a brass-rim glass tumbler, and a small antique-brass tray; a slipcovered cream linen accent chair to one side with a folded soft-blue waffle-cotton blanket; a hand-woven cream-and-soft-blue jute-and-cotton rug grounds the seating; a vintage white-painted Windsor side chair tucked at the back; a brass-framed leaning Nordic landscape watercolor against the side wall above a slim birch credenza; warm-dimmed brass-housed recessed cans glow in the beadboard ceiling. A tall casement window on the back wall shows soft late-afternoon summer light: visible green birch trees and pale-blue sky with light atmospheric haze, exterior soft but recognizable, gentle bright rolloff. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the beadboard ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 6% of the frame. Switched ON, soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  // L156 → CORNER 2-WALL, ELEVATED, 35mm NORMAL-WIDE — Modern Japandi dining room overcast morning
  {
    slug: "v12_L156_corner_ELEVATED_35mm_japandi_dining_overcast_morning",
    prompt:
      "CORNER TWO-WALL COMPOSITION, ELEVATED camera height (~6.5 ft — as if from the top of a stepladder), 35mm NORMAL-WIDE lens — natural-looking with slight room expansion. Camera positioned in a corner of the dining room showing two adjacent walls at a 45° angle, revealing more of the floor and layout. POOL ANCHOR (Line 156): Modern Japandi dining room with white-oak slat ceiling and tatami inset + low walnut table and woven-rush stools + Japandi — overcast morning. A horizontal white-oak slat ceiling runs overhead; honed-plaster walls in soft warm cream; the floor combines wide-plank pale white-oak with a rectangular inlaid tatami mat insert beneath the dining setup. ACCENT PALETTE — soft charcoal + cream + walnut + sage: a low walnut dining table centered on the tatami with six woven-rush stools tucked around it; on the table, a low ikebana arrangement of three slim cherry branches with sparse white buds in a pale-charcoal stoneware vessel, two folded soft-charcoal linen napkins with cream linen runners, a small woven-rush bread basket with a half-loaf of crusty bread, a stack of two cream-bound zen-design monographs spine-out, and a small cream ceramic bowl of citrus; a low walnut credenza along the side wall holds a slim cream ceramic vase with a single sprig of pampas grass and a folded sage linen tea towel; a brass-framed leaning ink-wash landscape against the credenza; a tall paper shoji-style sliding door at the back. A tall window beside the credenza shows soft overcast morning light: visible Japanese maple branches and pale-grey sky with light atmospheric haze, exterior soft and quiet. The ceiling fixture is mounted overhead at a slat junction, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the slat ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the slat ceiling. Designer-inhabited custom residence.",
  },
  // L359 → DOWN-CORRIDOR depth axis, STANDING, 24mm WIDE — Galley kitchen morning summer
  {
    slug: "v12_L359_corridor_depth_STANDING_24mm_galley_kitchen_morning",
    prompt:
      "DOWN-CORRIDOR DEPTH AXIS SHOT, STANDING eye-level (~5.5 ft), 24mm WIDE-ANGLE lens — strong depth emphasis, slight edge distortion expanding the galley space. Camera positioned at one end of the galley kitchen looking straight down its length toward a far window. POOL ANCHOR (Line 359): Galley kitchen with marble counters and brass hardware + tile backsplash + traditional — morning summer. Painted white shaker cabinetry runs both walls of the galley with antique-brass cup pulls; honed Calacatta-marble countertops along both sides; a glossy white subway tile backsplash with thin grey grout; wide-plank quarter-sawn white-oak floor stretches into the depth. ACCENT PALETTE — black + walnut + brass + cream linen: on the right counter, a wooden cutting board with a half-loaf of crusty bread and a brass-handled bread knife, a cream linen tea towel embroidered with a small black monogram, a stack of two cream-bound culinary monographs spine-out, an antique-brass salt cellar, and a small ceramic crock of wooden utensils; on the left counter, a tall cream ceramic pitcher of cut white-and-yellow garden wildflowers, a wooden bowl of citrus, and a brass-rim glass jar of dried herbs; a single woven jute runner runs down the wide-plank floor with fine fiber texture and subtle wear. The single Memphis ceiling fixture is mounted overhead in the mid-ground of the corridor (not bistro pendants — the Memphis flush IS the singular ceiling light here). The far window at the end shows soft morning summer light: visible green trees and pale-blue sky with light atmospheric haze, exterior soft but recognizable, gentle bright rolloff into the room. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. Designer-inhabited custom residence.",
  },
  // L395 → STRAIGHT-ON, STANDING, 85mm SHORT TELEPHOTO — Cliffside kitchen pavilion blue hour summer
  {
    slug: "v12_L395_straight_on_STANDING_85mm_cliffside_kitchen_pavilion_blue_hour",
    prompt:
      "STANDING EYE-LEVEL STRAIGHT-ON SHOT, STANDING eye-level (~5.5 ft), 85mm SHORT TELEPHOTO lens — compressed perspective, backgrounds feel closer to foreground, intimate magazine-editorial feel. Dead-on perpendicular framing of the sculptural bronze island, the fixture above, and the ocean view beyond compressed into a single plane. POOL ANCHOR (Line 395): [DAZUMA-CANONICAL] Contemporary cliffside kitchen pavilion with cantilevered concrete ceiling and infinity ocean view + sculptural bronze island + contemporary — blue hour summer. A cantilevered raw-concrete ceiling plane stretches overhead with thin recessed lighting strips at its perimeter; honed travertine floor; floor-to-ceiling steel-mullioned glass walls behind the island reveal an infinity-edge cliffside view of the ocean horizon. ACCENT PALETTE — charcoal + brass + bronze + cream: a sculptural rectangular bronze waterfall island dominates the foreground with a honed marble top; on the island, a small antique-brass tray with two travertine coasters, a single olive branch in a tall bronze-glaze stoneware vessel, a wooden cutting board with a half-loaf of seeded bread and a brass-handled cake knife, a cream linen tea towel folded loosely, a small charcoal ceramic bowl of citrus, and a stack of two cream-bound culinary monographs; three slim charcoal-linen counter stools with bronze legs tucked under one side; cream-painted Shaker cabinets along the back-corner wall with bronze cup pulls visible at the frame edges; a brass-and-bronze range hood half-visible. The glass walls reveal soft blue-hour summer light: silhouetted coastal pines against a deep navy sky graded to violet at horizon with a thin warm-amber band at the ocean horizon, faint atmospheric haze, exterior visible but muted and atmospheric — not blown out. Warm-dimmed recessed lighting strips along the concrete perimeter glow softly. The ceiling fixture is mounted above the island, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the concrete ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the concrete ceiling as the warm anchor of the blue-hour interior. Designer-inhabited custom residence.",
  },
  // L465 → 3/4 RIGHT, LOW, 50mm NORMAL — Home office Belgian overcast spring
  {
    slug: "v12_L465_3qtr_right_LOW_50mm_home_office_belgian_overcast_spring",
    prompt:
      "STANDING EYE-LEVEL 3/4 RIGHT, LOW camera height (~3 ft off the floor — seated eye level), 50mm NORMAL lens — natural human-eye perspective, intimate but grounded. Camera positioned to the RIGHT of center showing two walls of a Belgian home office at a 35° angle, the swivel chair and desk prominent in the foreground. POOL ANCHOR (Line 465): Home office with limewashed plaster ceiling and bleached oak chevron + heather-grey swivel chair and antique steel trunk + Belgian — overcast spring. Rough limewashed plaster ceiling above with subtle hand-troweled texture; rough-plastered walls in pale sand; bleached-oak chevron floor stretches across the room. ACCENT PALETTE — heather grey + cream + brass + soft sage: a vintage heather-grey wool swivel chair on a brass star base dominates the lower-right foreground with a folded cream cashmere throw draped over one arm; a slim bleached-oak writing desk against the back wall holds an open leather-bound journal with a brass-and-tortoise pen laid on the page, a small cream ceramic vessel with three sprigs of olive, a stack of two cream-bound design monographs with brass bookends, a brass-banded reading lamp (switched off, decorative), a small brass alarm clock, and a folded soft-sage linen napkin; an antique steel-and-leather trunk tucked beside the desk serves as a side surface holding a single dried hydrangea in a pale-grey stoneware vessel and a stack of three vintage leather-bound books; a vintage brass-framed antique architectural drawing leans against the side wall above a small floor stack of cream-bound monographs; a hand-knotted heather-grey-and-cream Persian rug grounds the seating with fine pile and visible wear. A tall window beyond the desk shows soft overcast spring light: visible green-budding tree branches and pale-grey sky with light atmospheric haze, exterior soft but recognizable, gentle bright rolloff. The ceiling fixture is mounted overhead, identical to the reference — Memphis-style compact semi-flush, small cream canopy flush to the limewashed plaster ceiling, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow on the limewashed ceiling. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v12-${path.basename(REF)}`);
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
