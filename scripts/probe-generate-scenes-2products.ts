/**
 * Multi-product scene generator. Each scene specifies its own product slug,
 * its own local reference-image path, and its own prompt. Uploads each unique
 * reference image to Supabase once, then fires all scenes in parallel through
 * kie.ai Nano Banana Pro. Outputs to C:\Users\pc\AppData\Local\Temp\scene\output\.
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

const REF_P1 = path.join(os.tmpdir(), "scene", "p1", "p1_3.jpg");
const REF_P2 = path.join(os.tmpdir(), "scene", "p2", "p2_1.jpg");

const GUARDRAILS = `ABSOLUTE REQUIREMENT — PRODUCT FIDELITY:
The reference image shows the exact fixture that must appear in the output. Replicate its shape, proportions, materials, finish, mounting hardware, and silhouette. Do NOT invent a different fixture or change the silhouette.

OUTPUT FORMAT — ONE SINGLE PHOTOGRAPH (not a collage, grid, triptych, mood board). A single 1:1 rectangular photograph.

US MARKET RULE — Western American home interior or exterior. ZERO Mandarin / Chinese / Asian characters anywhere in the frame. Any visible text must be English or abstract.

NO CAMERA / PHONE UI — no shutter button, no app chrome, no status bar, no viewfinder overlay. The image is the photograph itself, edge-to-edge.

NO HUMANS in any scene. Use implied presence only (folded throw, open book, parked car, open door with warm interior glow).

`;

interface Scene {
  slug: string;
  ref: string; // local file path of the supplier reference image
  prompt: string;
}

const SCENES: Scene[] = [
  // ============================================================
  // PRODUCT 1 — Walnut cream-petal SEMI-FLUSH MOUNT ceiling light
  // Category: semi-flush mount → MEDIUM zoom, ceiling-heavy, signature is row-of-3 in hallway
  // ============================================================
  {
    slug: "p1_1_gallery_hallway_three_in_a_row_evening",
    ref: REF_P1,
    prompt:
      "Wide gallery hallway shot straight down the corridor on a 28mm lens, eye-level standing height, slightly elevated. A coffered ceiling runs the full length above; deep crown molding meets tall paneled walls in soft warm white; herringbone white-oak floor stretches beneath a Persian runner with subtle wear. THREE OF THE SAME ceiling fixtures are mounted in a row down the corridor ceiling, evenly spaced. A leaning antique-gilt mirror sits against the right wall midway down beneath the second fixture. A vintage wooden bench with one folded linen pillow and an art book on its seat sits between two fixtures on the left. A tall arched window at the far end shows early-evening light; warm-dimmed recessed cans glow along the ceiling perimeter. Each ceiling fixture is identical to the reference — a compact semi-flush mount, occupying roughly 12% of the frame individually. Slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, with a cream-colored wavy/ribbed petal-shaped resin shade resembling a soft skirt-hem dome, irregular scalloped petals at the bottom edge. One E27 bulb visible inside each shade. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. The fixture is sized to anchor the scene without dominating it — meaningful presence, but the room and its architecture leads the eye. Architectural Digest custom residence, designer-inhabited, French cream transitional.",
  },
  {
    slug: "p1_2_grand_entryway_three_quarter_morning",
    ref: REF_P1,
    prompt:
      "A grand entryway on a 35mm lens, eye-level, strong 3/4 left angle, slightly elevated camera. A tall arched doorway frames the back with a paneled solid-walnut door and oversized matte-black hardware; deep crown molding meets a coffered ceiling; tall paneled walls in soft warm white run wall-to-wall; herringbone white-oak floor with a worn-in jute runner. A honed-travertine console below the fixture holds one sculptural ceramic vessel, an art book face-down, and a small unlacquered-brass dish with a single house key. A pair of well-worn leather loafers sit tucked beside the console; a camel trench coat hangs on a brass hook. A vintage gilt-framed mirror leans against the wall above the console rather than hanging. The single ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 14% of the frame. Slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream-colored wavy/ribbed petal-shaped resin shade with irregular scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. The fixture is sized to anchor without dominating — meaningful presence; the entryway and its architecture lead the eye. Custom-built residence, designer-inhabited, layered French-cream transitional.",
  },
  {
    slug: "p1_3_primary_bedroom_corner_morning",
    ref: REF_P1,
    prompt:
      "A quiet corner of a primary suite on a 35mm lens, eye-level seated, slight 3/4 left angle. A tray ceiling rises overhead with thin painted reveal trim; the back wall is a vertically-channeled oatmeal linen headboard wall. The bed enters at right with ivory linen bedding intentionally rumpled — not made, not messy — a charcoal wool throw at the foot, and a honed-marble tray on the duvet holding an open hardcover book with round wire-rim reading glasses laid on the page. A vintage walnut credenza on the left under the fixture holds a stack of two design monographs, one small ribbed ceramic vase with a single dried branch, and a half-burned beeswax taper in an unlacquered-brass holder. Linen drapes pulled to one side at the right pour soft morning daylight in; warm-dimmed recessed cans glow in the tray. The single ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 15% of the frame. Round walnut-wood canopy flush to the tray ceiling, suspended on a short walnut stem, cream-colored wavy/ribbed petal-shaped resin shade with scalloped bottom edge. One E27 bulb visible. Switched ON, soft warm 2700-3000K accent within the morning interior. The fixture is sized to anchor without dominating. Designer-inhabited custom residence, serene, lived-in.",
  },
  {
    slug: "p1_4_small_living_room_evening_coffered",
    ref: REF_P1,
    prompt:
      "A small modern transitional living room on a 35mm lens, eye-level, mild 3/4 right angle, framed wide. A coffered ceiling overhead in soft warm white; an oversized oatmeal linen sofa carries a charcoal wool throw draped over one arm; a vintage cognac leather club chair sits at a 45-degree angle beside the sofa; a round walnut side table holds a half-full ceramic mug on a travertine coaster and a single olive branch in a stoneware vase. A low travertine coffee table in the foreground shows an art book left face-down and a stack of design monographs spine-out. A worn vintage kilim rug grounds the seating. A floor-to-ceiling sash window at the right wall shows the last cool dusk light through linen drapes; cove-lighting strips glow warm at the ceiling-wall junction. The single ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 11% of the frame. Slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream-colored wavy/ribbed petal-shaped resin shade with irregular scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K accent. The fixture is sized to anchor without dominating; the room leads the eye. Designer-inhabited custom residence, lived-in, transitional.",
  },
  {
    slug: "p1_5_stair_landing_wide_morning",
    ref: REF_P1,
    prompt:
      "An open staircase landing on a 28mm lens, eye-level, slight 3/4 right angle, framed wide. A statement floor-to-ceiling steel-and-glass railing crosses the foreground; wide-plank quarter-sawn white-oak floor stretches across the landing; a tall floor-to-ceiling window above the stairwell pours cool mid-morning daylight in from camera-left; paneled walls in soft warm white climb to a coffered ceiling overhead. A small mid-century walnut chair sits tucked in the back corner with a folded charcoal wool throw across its seat; a large piece of muted-abstract art leans against the back wall rather than hanging. A single smooth river stone rests on the windowsill beside a stoneware vase holding one olive branch. The single ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 13% of the frame. Slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream-colored wavy/ribbed petal-shaped resin shade with scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling against the cool incoming daylight. The fixture is sized to anchor without dominating. Architectural Digest custom build, designer-inhabited.",
  },
  {
    slug: "p1_6_long_corridor_straight_dusk_cove",
    ref: REF_P1,
    prompt:
      "A long second-floor corridor shot straight down its length on a 28mm lens, eye-level standing height. A tray-and-reveal-trim ceiling runs the full length above; tall paneled walls in soft warm white meet deep baseboards; wide-plank herringbone white-oak floor stretches into the frame. A framed gallery wall of five mixed black-framed pieces — three small black-and-white travel photographs, an oil sketch, and a leaning framed mirror — hangs along the right wall midway down. A tall arched window at the far end glows with deep dusk blue light. Cove-lighting strips at the ceiling-wall junction glow soft warm. The single ceiling fixture is mounted midway down the corridor, identical to the reference — a compact semi-flush mount occupying roughly 14% of the frame. Slim round walnut-wood canopy flush to the tray ceiling, suspended on a short walnut stem, cream-colored wavy/ribbed petal-shaped resin shade with irregular scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow on the surrounding tray ceiling. The fixture is sized to anchor without dominating; the corridor architecture and gallery wall lead the eye. Custom residence, designer-inhabited, French cream transitional.",
  },

  // ============================================================
  // PRODUCT 2 — Long linear matte-black SOLAR OUTDOOR WALL LIGHT (bar style)
  // Category: outdoor wall lighting → MEDIUM, dusk/blue hour 70%, twin teardrop spill adapted to LINEAR warm wash
  // ============================================================
  {
    slug: "p2_1_front_facade_dusk_single_above_door",
    ref: REF_P2,
    prompt:
      "A custom-built residence front facade on a 35mm lens, eye-level, slight 3/4 left angle. Smooth troweled stucco facade in warm cream meeting a tall floor-to-ceiling black-mullioned glass entryway with a paneled solid-walnut front door. Premium landscaping flanks the entry path — two large matte-black planters with sculptural boxwood topiary, limestone-paver entry walk, ornamental grasses in the bed beyond. Warm interior glow leaks through the front-door sidelights and through the glass entryway, revealing a softly lit interior staircase and a glimpse of an antique-brass pendant fixture beyond. The sky is deep dusk — graded periwinkle-to-amber along the horizon, navy overhead. The single outdoor wall fixture is mounted high on the stucco above the front door, identical to the reference — a long horizontal matte-black linear bar with a slim rectangular profile, an angled polycrystalline solar panel on the top sloped surface, and a frosted white acrylic diffuser strip on the front face. Occupying roughly 14% of the frame. Switched ON, emitting a soft warm 2700-3000K linear wash on the stucco directly below with natural soft falloff. The fixture is sized to anchor the scene without dominating it — meaningful presence; the facade and landscaping lead the eye. Custom-built residence, designer-inhabited, contemporary transitional.",
  },
  {
    slug: "p2_2_garage_facade_blue_hour_single_long_bar",
    ref: REF_P2,
    prompt:
      "A wide custom-residence garage facade on a 28mm lens, eye-level, slight 3/4 right angle. Three modern wide oversize garage doors in dark-stained vertical-plank walnut, with a smooth troweled stucco facade above; an unlacquered-brass house number plate centered between two of the doors; mature trimmed boxwood hedges line the foreground of the bluestone-paver driveway. A single dark vehicle is parked at the right edge of the driveway, key plate visible. The sky is deep blue hour — periwinkle horizon graded to charcoal overhead. The single outdoor wall fixture is mounted high on the stucco above the center garage door, identical to the reference — a long horizontal matte-black linear bar with an angled polycrystalline solar panel on the top sloped surface and a frosted white acrylic diffuser strip on the front face. Occupying roughly 9% of the frame. Switched ON, emitting a soft warm 2700-3000K linear wash on the stucco directly below with natural soft falloff. The fixture is sized to anchor the scene without dominating it — the facade is the subject. Architectural Digest custom residence, designer-inhabited, contemporary modernist.",
  },
  {
    slug: "p2_3_paired_porch_evening_two_bars",
    ref: REF_P2,
    prompt:
      "A deep covered front porch on a 35mm lens, eye-level, straight-on framing. A stone fireplace with a linear gas insert anchors the back wall; tall horizontal board-and-batten siding in warm cream rises to a vaulted wood-plank ceiling above; a slim wood-and-rope hanging swing at the right with one charcoal wool throw draped over the seat; an oversized oatmeal linen sectional sofa against the left wall with one ivory bouclé pillow and a folded throw; a low travertine coffee table in front holds a half-full ceramic mug on a coaster and a stack of two design books. The view past the porch shows mature ornamental grasses and deep-evening sky. TWO of the same outdoor wall fixtures are mounted on the side walls — one on the left wall above the sectional, one on the right wall above the swing — identical to the reference. Each is a long horizontal matte-black linear bar with an angled polycrystalline solar panel on top and a frosted white acrylic diffuser strip on the front face. Each occupies roughly 10% of the frame. Switched ON, emitting a soft warm 2700-3000K linear wash on the board-and-batten siding directly below with natural soft falloff. The fixtures anchor the scene without dominating. Designer-inhabited custom residence, lived-in, transitional.",
  },
  {
    slug: "p2_4_pool_house_wall_dusk_single_high",
    ref: REF_P2,
    prompt:
      "A custom pool-house exterior wall on a 35mm lens, eye-level, slight 3/4 right angle, framed wide. A smooth troweled stucco pool-house wall in warm cream meets a travertine pool deck in the foreground; a designed rectangular pool occupies the lower-left, its surface reflecting the warm linear glow of the fixture above. A slim modern outdoor sectional in charcoal linen with one ivory bouclé throw pillow and one folded wool blanket sits along the wall under the fixture; a small round travertine side table holds a half-full glass of water and an open art book left face-down. Mature pampas-grass and one potted olive tree flank the seating. The sky is deep dusk — graded periwinkle-to-amber along the horizon. The single outdoor wall fixture is mounted high on the stucco above the sectional, identical to the reference — a long horizontal matte-black linear bar with an angled polycrystalline solar panel on the top sloped surface and a frosted white acrylic diffuser strip on the front face. Occupying roughly 12% of the frame. Switched ON, emitting a soft warm 2700-3000K linear wash on the stucco directly below with natural soft falloff. The fixture is sized to anchor without dominating; the pool terrace leads the eye. Custom residence, designer-inhabited.",
  },
  {
    slug: "p2_5_garden_wall_night_single_bar_planting",
    ref: REF_P2,
    prompt:
      "A custom-residence garden wall on a 35mm lens, eye-level, slight 3/4 left angle. A long horizontal-board cedar privacy fence in weathered grey-brown runs the full back of the frame; a deep mulched planting bed with mature ornamental grasses (miscanthus and Russian sage in violet bloom) and clipped boxwood balls in the foreground; a bluestone-paver path runs along the foot of the fence. Two large matte-black planters with sculptural olive trees flank the path. The sky is full deep-blue night with one bright planet visible above the fence-line; warm interior glow from a distant window glows softly through the foliage on the right. The single outdoor wall fixture is mounted high on the cedar fence, identical to the reference — a long horizontal matte-black linear bar with an angled polycrystalline solar panel on the top sloped surface and a frosted white acrylic diffuser strip on the front face. Occupying roughly 11% of the frame. Switched ON, emitting a soft warm 2700-3000K linear wash on the cedar planks directly below with natural soft falloff. The fixture is sized to anchor the scene without dominating; the planting and fence lead the eye. Architectural Digest custom residence, designer-inhabited, contemporary landscape.",
  },
  {
    slug: "p2_6_long_facade_pair_blue_hour_modernist",
    ref: REF_P2,
    prompt:
      "A long modernist residence facade on a 28mm lens, eye-level, slight 3/4 right angle, framed very wide. A horizontal limestone-clad wall meets a band of black-mullioned floor-to-ceiling windows running the length of the facade; warm interior glow reveals a glimpse of a custom kitchen with brass pendants beyond the glass. A bluestone-paver path runs along the foot of the wall, with mature ornamental grasses and clipped boxwood lining it; one large matte-black planter with a sculptural fig tree anchors the right edge. The sky is deep blue hour — periwinkle horizon graded to charcoal overhead. TWO of the same outdoor wall fixtures are mounted at intervals along the limestone wall above the windows — one over the front entry, one over a second symmetric panel — identical to the reference. Each is a long horizontal matte-black linear bar with an angled polycrystalline solar panel on top and a frosted white acrylic diffuser strip on the front face. Each occupies roughly 7% of the frame. Switched ON, emitting a soft warm 2700-3000K linear wash on the limestone directly below with natural soft falloff. The fixtures anchor the scene without dominating; the long facade leads the eye. Custom-built residence, designer-inhabited, contemporary modernist.",
  },
];

interface KieCreateResp { code?: number; msg?: string; data?: { taskId?: string }; }
interface KiePollResp { code?: number; msg?: string; data?: { state?: string; failMsg?: string; failCode?: string; resultJson?: string; }; }

async function kieCreateTask(prompt: string, imageUrl: string): Promise<string> {
  const token = process.env.KIE_API_KEY!;
  const res = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: { prompt, image_input: [imageUrl], aspect_ratio: "1:1", resolution: RESOLUTION, output_format: "png" },
    }),
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
    const res = await fetch(`${KIE_POLL_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
  throw new Error(`kie poll timeout after ${KIE_TIMEOUT_MS / 1000}s`);
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
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_* not set");

  const outDir = path.join(os.tmpdir(), "scene", "output");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = Date.now();
  const uniqueRefs = [...new Set(SCENES.map((s) => s.ref))];
  console.log(`Uploading ${uniqueRefs.length} unique reference image(s) to Supabase...`);
  const refMap = new Map<string, string>();
  for (const ref of uniqueRefs) {
    const fname = path.basename(ref);
    const remoteUrl = await uploadRef(ref, `_scene-refs/${stamp}-${fname}`);
    refMap.set(ref, remoteUrl);
    console.log(`  ${fname} -> ${remoteUrl}`);
  }

  const toRun = SCENES.filter((s) => {
    const outPath = path.join(outDir, `${s.slug}.png`);
    if (fs.existsSync(outPath)) { console.log(`  [skip] ${s.slug}`); return false; }
    return true;
  });
  if (toRun.length === 0) { console.log("\nNothing to generate."); return; }

  console.log(`\nFiring ${toRun.length} Nano Banana Pro task(s) at ${RESOLUTION}...`);
  const tasks = await Promise.all(toRun.map(async (s) => {
    const imageUrl = refMap.get(s.ref)!;
    const taskId = await kieCreateTask(GUARDRAILS + s.prompt, imageUrl);
    console.log(`  [${s.slug}] taskId=${taskId}`);
    return { s, taskId };
  }));

  console.log(`\nPolling all ${tasks.length} tasks...`);
  const results = await Promise.allSettled(tasks.map(async ({ s, taskId }) => {
    const buf = await kiePoll(taskId);
    const outPath = path.join(outDir, `${s.slug}.png`);
    fs.writeFileSync(outPath, buf);
    return { s, outPath };
  }));

  console.log(`\nResults (saved under ${outDir}):`);
  let ok = 0, fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const slug = toRun[i].slug;
    if (r.status === "fulfilled") { console.log(`  OK   ${slug}`); ok++; }
    else { console.log(`  FAIL ${slug} -> ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`); fail++; }
  }
  console.log(`\nDone. ${ok} succeeded, ${fail} failed. Folder: ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
