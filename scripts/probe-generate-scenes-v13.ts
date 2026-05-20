/**
 * v13 — Memphis cream-donut + red-ball flush mount, same 6 rooms as v12, NEW composition tags.
 *
 * Composition tag distribution (per new variety constraints):
 *   L23  → FIXTURE_THIRDS_LEFT          (asymmetric, room weight to right 2/3)
 *   L99  → FIXTURE_HERO_CENTER          (canonical wide establishing)
 *   L156 → FIXTURE_FOREGROUND_BOKEH     (foreground ikebana sharp, fixture soft above)
 *   L359 → FIXTURE_THROUGH_DOORWAY      (camera in adjacent room, doorway frame visible)
 *   L395 → FIXTURE_REFLECTED            (in polished bronze island top + glass wall)
 *   L465 → FIXTURE_CROPPED              (top of frame cuts the fixture; desk + chair dominant)
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

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — Memphis-style compact semi-flush mount. Small round CREAM-painted aluminum canopy mounted flush to the ceiling. Suspended just beneath the canopy is a flat disc/donut-shaped shade in amber-tinted clear glass with rounded rolled edges, a frosted white acrylic diffuser disc visible in the center underside emitting warm light. A SMALL RED CERAMIC BALL ACCENT sits at the connection point between canopy and shade.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS — visible but soft: real trees, branches, hedges, pale soft sky. Brighter than interior but NOT pure white blown-out. Soft natural rolloff. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // L23 → FIXTURE_THIRDS_LEFT
  {
    slug: "v13_L23_THIRDS_LEFT_belgian_sitting_room_blue_hour",
    prompt:
      "COMPOSITION — FIXTURE_THIRDS_LEFT: The ceiling fixture is positioned in the UPPER-LEFT THIRD of the frame following rule-of-thirds composition. The right two-thirds are occupied by the room's furniture and styled vignette — visual weight is asymmetric, attention shifts to the room. Fixture occupies roughly 7% of the frame. Camera angle: standing eye-level 3/4 left. Camera height: LOW (~3 ft off the floor — chair height). Lens: 50mm normal, natural human-eye perspective. POOL ANCHOR (Line 23): Belgian-modern sitting room with limewashed plaster walls and bleached oak beams + sand-toned linen seating + Belgian — blue hour winter. Rough limewashed plaster walls with hand-troweled texture; exposed bleached-oak beams overhead. ACCENT PALETTE — sand + cream + brass + soft sage: filling the right two-thirds of the frame, a deep oversized sand-linen sofa anchors the foreground with two layered cushions in cream bouclé and faded soft-sage linen and a folded cream wool throw draped over one arm; a low round bleached-oak coffee table in front holds a half-burned cream beeswax taper in an antique-brass holder, a small soft-sage stoneware vessel with three sprigs of olive, a stack of two cream-bound design monographs spine-out, and a brass-rim ceramic mug; a slim sand-linen slipper chair tucked at the right edge with a folded cream wool throw; a hand-knotted heritage sand-and-cream wool rug grounds the seating. A tall window behind the sofa on the right shows soft fading blue-hour winter light: silhouetted bare branches against a quiet violet-grey evening sky with subtle warm horizon band. The fixture sits in the upper-left third of the frame, identical to the reference — Memphis-style compact semi-flush, cream canopy flush to a beam panel on the left side, flat amber-glass donut shade, frosted white diffuser underneath, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow on the limewashed plaster. Designer-inhabited custom residence.",
  },
  // L99 → FIXTURE_HERO_CENTER
  {
    slug: "v13_L99_HERO_CENTER_scandi_summer_cottage",
    prompt:
      "COMPOSITION — FIXTURE_HERO_CENTER: The ceiling fixture is positioned upper-center of the frame, clearly visible and well-lit as the focal accent of the ceiling. The room is the broader hero; the fixture anchors it warmly. Fixture occupies roughly 10% of the frame. Camera angle: wide establishing, straight-on. Camera height: STANDING (~5.5 ft). Lens: 28mm wide-angle, slight depth expansion. POOL ANCHOR (Line 99): Scandinavian summer cottage living room with painted beadboard ceiling and pine plank floor + slipcovered linen sofa and birch branch arrangement + Scandinavian — late afternoon summer. Painted white beadboard ceiling above with thin painted exposed beams; whitewashed pine plank floor stretches across the room. ACCENT PALETTE — bleached birch + cream + soft blue + brass: an oversized slipcovered ivory linen sofa anchors the room with two layered cushions in cream waffle-cotton and soft-blue ticking stripe and a folded cream cable-knit throw; a low round bleached-birch coffee table holds a tall white stoneware pitcher of birch branches, a stack of two cream-bound Nordic-design monographs spine-out, a brass-rim glass tumbler, and a small antique-brass tray; a slipcovered cream linen accent chair to one side with a folded soft-blue waffle-cotton blanket; a hand-woven cream-and-soft-blue jute-and-cotton rug; a brass-framed leaning Nordic landscape watercolor against the side wall above a slim birch credenza. A tall casement window on the back wall shows soft late-afternoon summer light: visible green birch trees and pale-blue sky with light atmospheric haze. The ceiling fixture is identical to the reference — Memphis-style compact semi-flush, small cream canopy upper-center of the frame, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  // L156 → FIXTURE_FOREGROUND_BOKEH
  {
    slug: "v13_L156_FOREGROUND_BOKEH_japandi_dining",
    prompt:
      "COMPOSITION — FIXTURE_FOREGROUND_BOKEH: A FOREGROUND OBJECT — a tall slim pale-charcoal stoneware ikebana vessel holding three cherry branches with sparse white buds — sits sharp in the immediate foreground in the lower middle of the frame, shallow depth-of-field on it. The ceiling fixture is visible above it but rendered SOFT and slightly out-of-focus — present and recognizable but not the focal point. Fixture occupies roughly 10% of the frame in soft focus. Camera angle: off-center vignette. Camera height: LOW (~3 ft). Lens: 85mm short telephoto, compressed perspective, shallow depth-of-field. POOL ANCHOR (Line 156): Modern Japandi dining room with white-oak slat ceiling and tatami inset + low walnut table and woven-rush stools + Japandi — overcast morning. Horizontal white-oak slat ceiling visible above with thin gaps between slats; honed-plaster walls in soft warm cream; rectangular tatami mat insert beneath the dining setup. ACCENT PALETTE — soft charcoal + cream + walnut + sage: the ikebana vessel with cherry branches occupies the sharp foreground; behind it, slightly soft, a low walnut dining table with four woven-rush stools tucked around it on the tatami, two folded soft-charcoal linen napkins with cream linen runners, a small woven-rush bread basket, a stack of two cream-bound zen-design monographs, and a small cream ceramic bowl of citrus; a low walnut credenza along the side wall with a sage linen tea towel; a brass-framed leaning ink-wash landscape against the credenza, also slightly soft. A tall window beside the credenza shows soft overcast morning light visible Japanese maple branches and pale-grey sky beyond. The ceiling fixture appears in soft focus above the foreground ikebana, identical to the reference — Memphis-style compact semi-flush, small cream canopy, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  // L359 → FIXTURE_THROUGH_DOORWAY
  {
    slug: "v13_L359_THROUGH_DOORWAY_galley_kitchen_morning",
    prompt:
      "COMPOSITION — FIXTURE_THROUGH_DOORWAY: The camera is positioned in an ADJACENT BREAKFAST AREA, looking through an open CASED DOORWAY into the galley kitchen where the fixture is mounted. The doorway frame — cream-painted millwork casing with subtle shadow lines on both sides — is clearly visible in the foreground occupying the outer edges of the frame. The fixture is visible in the middle ground of the kitchen beyond. Fixture occupies roughly 8% of the frame. Camera angle: through-doorway depth axis. Camera height: STANDING (~5.5 ft). Lens: 35mm normal-wide. POOL ANCHOR (Line 359): Galley kitchen with marble counters and brass hardware + tile backsplash + traditional — morning summer. The breakfast-area foreground shows a corner of a small round bleached-oak breakfast table with a brass-rim glass pitcher of yellow garden wildflowers and a cream-rim ceramic bowl of citrus partially in frame. Through the doorway: painted white shaker cabinetry on both walls with antique-brass cup pulls, honed Calacatta-marble counters, glossy white subway tile backsplash. ACCENT PALETTE — black + walnut + brass + cream linen: on the right counter, a wooden cutting board with a half-loaf of crusty bread and a brass-handled bread knife, a cream linen tea towel embroidered with a small black monogram, a stack of two cream-bound culinary monographs, an antique-brass salt cellar; on the left counter, a tall cream ceramic pitcher of cut white-and-yellow garden flowers and a wooden bowl of citrus; a single woven jute runner on the wide-plank oak floor. A far window at the end of the galley shows soft morning summer light visible green trees and pale-blue sky. The ceiling fixture is mounted overhead in the kitchen middle-ground, framed by the doorway, identical to the reference — Memphis-style compact semi-flush, cream canopy, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow on the kitchen ceiling. Designer-inhabited custom residence.",
  },
  // L395 → FIXTURE_REFLECTED
  {
    slug: "v13_L395_REFLECTED_cliffside_kitchen_pavilion",
    prompt:
      "COMPOSITION — FIXTURE_REFLECTED: The ceiling fixture appears prominently as a REFLECTION in the polished SCULPTURAL BRONZE ISLAND TOP and also faintly mirrored in the floor-to-ceiling glass wall behind. The direct fixture is partially out of frame at the top edge — the viewer sees the fixture's clear reflection on the bronze island surface and ghost-reflection in the dark blue-hour glass. This is a sophisticated, subtle framing — the fixture is present through reflection rather than direct view. Camera angle: standing eye-level straight-on. Camera height: STANDING (~5.5 ft). Lens: 50mm normal, intimate but grounded. POOL ANCHOR (Line 395): [DAZUMA-CANONICAL] Contemporary cliffside kitchen pavilion with cantilevered concrete ceiling and infinity ocean view + sculptural bronze island + contemporary — blue hour summer. A cantilevered raw-concrete ceiling visible only at the upper frame edges (fixture is at the very top, cropped above); honed travertine floor; floor-to-ceiling steel-mullioned glass walls behind the island reveal soft blue-hour summer light: silhouetted coastal pines against a deep navy sky graded to violet at horizon with a thin warm-amber band, exterior visible and atmospheric. ACCENT PALETTE — charcoal + brass + bronze + cream: a sculptural rectangular polished-bronze waterfall island dominates the foreground with a mirrored top — the donut shape and red ball accent of the fixture clearly visible in the bronze reflection; on the island, a small antique-brass tray with two travertine coasters, a single olive branch in a tall bronze-glaze stoneware vessel, a wooden cutting board with a half-loaf of seeded bread and a brass-handled cake knife, a cream linen tea towel folded loosely, a small charcoal ceramic bowl of citrus; three slim charcoal-linen counter stools with bronze legs tucked under one side; cream-painted Shaker cabinets along the back-corner wall with bronze cup pulls. Warm-dimmed recessed lighting strips along the concrete perimeter glow softly. The fixture itself is mostly cropped above the frame; its REFLECTION on the bronze island top is the primary visual reference — Memphis-style compact semi-flush, cream canopy, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent all clearly seen in the reflection. Switched ON. Designer-inhabited custom residence.",
  },
  // L465 → FIXTURE_CROPPED
  {
    slug: "v13_L465_CROPPED_home_office_belgian_overcast_spring",
    prompt:
      "COMPOSITION — FIXTURE_CROPPED: The top edge of the frame CUTS THROUGH the ceiling fixture — only the LOWER PORTION of the donut shade and its red ball accent are visible at the very top of the frame. The fixture is partially visible but cropped; this signals the fixture exists in the scene without making it the focal element. The desk, swivel chair, and styled surface dominate the frame. Fixture lower portion occupies roughly 8% of the frame. Camera angle: standing eye-level 3/4 right. Camera height: LOW (~3 ft — seated eye level). Lens: 35mm normal-wide. POOL ANCHOR (Line 465): Home office with limewashed plaster ceiling and bleached oak chevron + heather-grey swivel chair and antique steel trunk + Belgian — overcast spring. Rough limewashed plaster ceiling visible only at the very top of the frame with the fixture's lower edge cropped against it; rough-plastered walls in pale sand; bleached-oak chevron floor stretches across the room. ACCENT PALETTE — heather grey + cream + brass + soft sage: a vintage heather-grey wool swivel chair on a brass star base dominates the lower-right foreground with a folded cream cashmere throw draped over one arm; a slim bleached-oak writing desk against the back wall holds an open leather-bound journal with a brass-and-tortoise pen, a small cream ceramic vessel with three sprigs of olive, a stack of two cream-bound design monographs with brass bookends, a brass-banded reading lamp (switched off, decorative), a small brass alarm clock, and a folded soft-sage linen napkin; an antique steel-and-leather trunk tucked beside the desk holds a single dried hydrangea in a pale-grey stoneware vessel and a stack of three vintage leather-bound books; a vintage brass-framed antique architectural drawing leans against the side wall; a hand-knotted heather-grey-and-cream Persian rug grounds the seating. A tall window beyond the desk shows soft overcast spring light visible green-budding tree branches and pale-grey sky. The fixture is cropped at the top of the frame, only its lower portion visible — Memphis-style compact semi-flush, lower half of cream canopy and the amber-glass donut shade visible, small RED CERAMIC BALL accent visible at the rim. Switched ON, soft warm 2700-3000K glow spilling down from the cropped fixture. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v13-${path.basename(REF)}`);
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
