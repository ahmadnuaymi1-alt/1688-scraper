/**
 * v4 multi-product generator. Applies all four skill refinements:
 *   1. Scene-pool sampling (≥3 DAZUMA-CANONICAL per set, varied across products)
 *   2. Styled density (8-12 distinct elements per scene)
 *   3. Color accent palette (varied per scene, 3-5 echo points)
 *   4. Outdoor sky realism (varied atmospheric detail per scene)
 * Per-category composition rules preserved.
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

const REF_P1 = path.join(os.tmpdir(), "scene", "p1", "p1_3.jpg"); // cream-petal semi-flush
const REF_P2 = path.join(os.tmpdir(), "scene", "p2new", "p2_2.jpg"); // matte-black rectangular outdoor sconce

const GUARDRAILS = `ABSOLUTE REQUIREMENT — PRODUCT FIDELITY:
The reference image shows the exact fixture that must appear. Replicate its shape, proportions, materials, finish, mounting hardware, and silhouette. Do NOT invent a different fixture, do NOT change the silhouette.

OUTPUT FORMAT — ONE SINGLE photograph, 1:1 rectangular. No collage, grid, mood board.

US MARKET RULE — Western American home interior or exterior. ZERO Mandarin / Chinese / Asian characters anywhere in the frame. Any visible text must be English or abstract.

NO CAMERA / PHONE UI elements. The image IS the photograph itself.

NO HUMANS, NO PETS. Use implied presence only (folded throw, open book, parked car, open door with warm interior glow).

`;

interface Scene { slug: string; ref: string; prompt: string; }

const SCENES: Scene[] = [
  // ============================================================
  // PRODUCT 1 — Walnut canopy + cream wavy-ribbed petal-shade SEMI-FLUSH MOUNT
  // Category: semi-flush mount → MEDIUM, ceiling-heavy, ≥1 hallway lineup
  // ============================================================
  {
    slug: "v4_p1_1_three_in_a_row_corridor_brass_cognac_sage",
    ref: REF_P1,
    prompt:
      "Wide gallery hallway shot straight down the corridor on a 28mm lens, eye-level standing height, slightly elevated. A coffered ceiling runs the full length above; deep crown molding meets tall paneled walls in warm cream; herringbone white-oak floor stretches into the frame beneath a worn-in Persian runner showing fine pile texture. ACCENT PALETTE — brass + cognac leather + sage green: a cognac-leather Chesterfield bench against the right wall midway down with a folded sage-green wool throw draped over its arm and a stack of two design books on the seat; a tall sage-green ceramic vase on a low travertine plinth holding a single dried branch; a brass-framed gallery wall of five mixed pieces — three small black-and-white travel photographs, a small oil sketch, and a leaning brass-rimmed mirror; antique-brass picture lights above two of the frames; a brass-bound design book stack on a small cognac-leather stool; cognac-leather house keys on a brass dish on a console; warm-dimmed brass-housed recessed cans at the ceiling perimeter. A tall arched window at the far end shows early-evening light. THREE OF THE SAME ceiling fixtures are mounted in a row down the coffered ceiling, evenly spaced — each identical to the reference: slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, with a cream wavy/ribbed petal-shaped resin shade with irregular scalloped bottom petals. One E27 bulb visible in each. Switched ON, soft warm 2700-3000K glow on the coffered ceiling. Each fixture occupies roughly 11% of the frame individually. The fixtures are sized to anchor without dominating; the corridor and gallery wall lead the eye. Architectural Digest custom residence, designer-inhabited.",
  },
  {
    slug: "v4_p1_2_gallery_hallway_evening_navy_brass_cream",
    ref: REF_P1,
    prompt:
      "A long gallery hallway on a 35mm lens, eye-level, slight 3/4 right angle. A coffered ceiling overhead in soft warm white; deep crown molding meets tall paneled walls; herringbone white-oak floor beneath a hand-knotted navy-and-cream vintage runner with visible wear. ACCENT PALETTE — navy + brass + cream + dried branch: a slim brass-legged console along the right wall holding a tall navy ceramic vase with a single dried wisteria branch, a stack of three cream-spined hardcover novels with brass bookends, a navy linen-bound photo album face-down, and a small unlacquered-brass dish with a single house key; a cream-painted bench in the foreground with a folded navy wool throw and one ivory bouclé cushion; a tall navy-matted gallery wall of four mixed frames — two black-and-white architectural photographs in slim brass frames, a small navy oil sketch, and a leaning antique gilt mirror; brass-housed recessed cans glow warm-dim; a pair of small navy-glazed ceramic figurines on a low brass tray; navy linen drapes pulled to one side at a far arched window showing deep-evening cool blue light through wavy cirrus clouds. The single ceiling fixture is mounted overhead, identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow occupying roughly 13% of the frame. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v4_p1_3_small_modern_entry_forest_green_brass_walnut",
    ref: REF_P1,
    prompt:
      "A small modern entry on a 35mm lens, eye-level, slight 3/4 left angle. A coffered ceiling overhead in soft warm white; paneled walls in warm cream; wide-plank white-oak floor beneath a worn-in oat-and-forest-green wool runner. ACCENT PALETTE — forest green + brass + walnut + cream: a vintage walnut-and-brass bench along the right wall with a folded forest-green wool throw draped over its arm, a pair of well-worn cognac leather loafers tucked underneath, and an open hardcover design book with round wire-rim reading glasses laid on the page resting on the seat; a tall walnut console behind it holds a small brass dish with a single house key, a forest-green ceramic vessel with a single olive branch, a stack of two design monographs with brass bookends, and a half-burned beeswax taper in an unlacquered-brass holder; a brass-framed leaning antique gilt mirror above the console; a small gallery wall of three pieces — two black-framed travel photographs and a small oil sketch of a forest scene; warm interior glow from a hidden cove-lighting strip washes down the cream wall. The single ceiling fixture is mounted overhead, identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow occupying roughly 14% of the frame. The fixture is sized to anchor without dominating. Custom-built residence, designer-inhabited.",
  },
  {
    slug: "v4_p1_4_bedroom_corner_morning_terracotta_cream_brass",
    ref: REF_P1,
    prompt:
      "A quiet primary suite corner on a 35mm lens, eye-level seated, slight 3/4 left angle. A tray ceiling rises with thin painted reveal trim; the back wall is a vertically-channeled oatmeal linen headboard wall. ACCENT PALETTE — terracotta + cream + brass + olive: the bed enters at right with ivory linen bedding intentionally rumpled (not made, not messy), a terracotta wool throw at the foot, two layered cushions in cream linen and terracotta bouclé, and a brass tray on the duvet holding an open hardcover poetry book with round tortoise-rim reading glasses laid on the page; a vintage walnut credenza on the left under the fixture holds a stack of two hardcover art books, a small terracotta ceramic vessel with a single olive branch, a half-burned beeswax taper in an unlacquered-brass holder, a small bronze sculpture, and a brass picture frame with a sepia photograph; a terracotta-and-cream Persian rug on the floor with visible pile and subtle wear; linen drapes pulled to one side let soft morning daylight in through wispy cirrus clouds visible beyond the glass; warm-dimmed brass-housed recessed cans in the tray. The single ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to the tray ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K accent occupying roughly 12% of the frame. The fixture is sized to anchor without dominating. Designer-inhabited custom residence, serene.",
  },
  {
    slug: "v4_p1_5_top_of_stairs_gallery_black_walnut_jute_brass",
    ref: REF_P1,
    prompt:
      "A top-of-stairs gallery overlooking a foyer on a 28mm lens, eye-level, slight 3/4 right angle, framed wide. A coffered ceiling overhead; paneled walls in warm cream; wide-plank quarter-sawn white-oak floor beneath a woven jute runner with visible texture. ACCENT PALETTE — black + walnut + jute + brass: a matte-black steel-and-glass railing crosses the foreground; a vintage black-painted Windsor chair tucked in the corner with a folded charcoal wool throw across its seat; a large black-framed muted-abstract piece leans against the back wall on the floor rather than hanging; a single smooth river stone rests on the windowsill beside a jute-wrapped stoneware vase holding one olive branch; a black-bound design book stack on a small walnut stool, brass-cornered; a brass-rimmed leaning antique mirror against the side wall; a black-and-brass picture-light above a small framed pencil sketch; a single black ceramic vessel on the windowsill; a worn-in jute mat overlapping the runner. A tall floor-to-ceiling window above the stairwell pours cool mid-morning daylight in from camera-left through scattered broken cumulus clouds; warm interior glow from below. The single ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow occupying roughly 11% of the frame. The fixture is sized to anchor without dominating. Architectural Digest custom build, designer-inhabited.",
  },
  {
    slug: "v4_p1_6_mudroom_pass_through_soft_blue_walnut_cream",
    ref: REF_P1,
    prompt:
      "A mudroom-to-kitchen pass-through on a 35mm lens, eye-level, straight-on framing. A tray ceiling above with thin painted reveal trim; tongue-and-groove paneled walls in warm cream; stone-tile flooring in a soft-blue-grey limestone with visible veining and wear. ACCENT PALETTE — soft blue + walnut + cream + brass: a vintage walnut built-in bench against the right wall with cream bouclé cushions and a folded soft-blue linen throw, and a pair of well-worn leather riding boots tucked underneath; a walnut wall-hung shelf above the bench holds a small cream ceramic crock with wooden utensils, a stack of two cream linen tea towels, a brass alarm clock, and a small soft-blue ceramic vase with a single dried branch; a row of brass hooks below holding a navy canvas tote, a chambray work jacket, and a soft-blue wool scarf; a built-in cubby beside the bench holds two pairs of folded cream linen napkins and a brass-handled wicker basket; a glimpse of the kitchen beyond shows a marble waterfall island; an arched window above the bench shows late-afternoon golden light through a few scattered cirrus clouds; brass-housed sconces flanking the doorway glow warm. The single ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to the tray ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow occupying roughly 13% of the frame. The fixture is sized to anchor without dominating. Custom residence, designer-inhabited.",
  },

  // ============================================================
  // PRODUCT 2 — Compact matte-black rectangular outdoor wall sconce (acrylic panel, ~165×205mm portrait, 24W LED)
  // Category: outdoor wall lighting → MEDIUM, ≥2-3 paired-flanking-door scenes, ALL dusk/blue/night
  // ============================================================
  {
    slug: "v4_p2_1_paired_modern_front_door_stucco_dusk_black_walnut_jute_brass",
    ref: REF_P2,
    prompt:
      "A custom-built residence modern front entry on a 35mm lens, eye-level, dead-on straight framing. A smooth troweled stucco facade in warm cream with tall floor-to-ceiling black-mullioned glass sidelights flanking a paneled solid-walnut front door with oversized matte-black hardware. ACCENT PALETTE — black + walnut + jute + brass: two large matte-black planters with sculptural boxwood topiary balls flank the limestone-paver entry walk; the walk has visible texture and a slight rain-staining at one edge; a woven jute runner trails from inside the open door to the threshold; a chambray jacket hangs on a brass hook visible through the open door; warm interior glow reveals a glimpse of a brass pendant fixture and a small Windsor chair with a folded jute throw inside. The sky is deep dusk — warm peach at the horizon fading through pink/lavender to deep navy at zenith, with wispy cirrus clouds high overhead and one bright planet appearing. Distant trees silhouette against the sky with visible individual branch detail; faint mist at ground level around the boxwood. TWO of the same outdoor wall fixtures are mounted symmetrically on the stucco — one to the left of the door, one to the right — identical to the reference: compact matte-black rectangular wall sconce with a thick matte-black aluminum frame wrapping a frosted white acrylic light panel, portrait orientation, mounted flush against the stucco. Each occupies roughly 8% of the frame. Switched ON, emitting a soft warm 2700-3000K glow with a gentle up/down warm wash on the stucco around each sconce. The fixtures are sized to anchor without dominating; the facade leads the eye. Architectural Digest custom-built residence, designer-inhabited.",
  },
  {
    slug: "v4_p2_2_paired_limestone_wood_door_blue_hour_charcoal_brass_olive_linen",
    ref: REF_P2,
    prompt:
      "A custom-residence limestone entry on a 35mm lens, eye-level, slight 3/4 left angle. A book-matched honed-limestone facade with subtle veining; a recessed solid-walnut front door with vertical reeded paneling and oversized antique-brass hardware. ACCENT PALETTE — charcoal + brass + olive + linen: two large charcoal-glazed stoneware planters with mature olive trees flank the bluestone-paver entry walk; a charcoal cast-iron boot scraper sits beside the door; a brass-framed slate house-number plaque mounted on the limestone; a worn-in olive-linen welcome mat at the threshold; clipped boxwood balls in low brass-trimmed planters line the walk's edge; a pair of well-worn cognac leather loafers tucked just inside the door, visible through a sliver of warm interior glow; a folded olive-linen throw on a brass-and-leather entry bench inside. The sky is deep blue hour — cool dominant tone with a thin warm peach band at the horizon, layered cumulus clouds piling low on the right, a contrail crossing the upper sky, and the moon partially visible through atmospheric haze. Trees in the background silhouette with visible texture. TWO of the same outdoor wall fixtures are mounted symmetrically on the limestone — one to each side of the door — identical to the reference: compact matte-black rectangular wall sconce with thick matte-black aluminum frame wrapping a frosted white acrylic light panel, portrait orientation. Each occupies roughly 7% of the frame. Switched ON, emitting a soft warm 2700-3000K glow with a gentle wash on the limestone around each sconce. The fixtures anchor without dominating; the limestone facade leads the eye. Designer-inhabited custom residence.",
  },
  {
    slug: "v4_p2_3_paired_arched_brick_entry_dusk_terracotta_cream_brass_olive",
    ref: REF_P2,
    prompt:
      "A traditional brick-and-arch entry on a 35mm lens, eye-level, dead-on framing. A handmade Boston-blend brick facade with deep mortar lines and subtle weathering; a recessed paneled walnut front door under a Roman-arched limestone surround with oversized antique-brass hardware. ACCENT PALETTE — terracotta + cream + brass + olive: two large terracotta-glazed planters with mature olive trees flank the bluestone-paver path; a terracotta tile threshold; a brass house-number plaque on the brick; a cream linen welcome mat at the threshold; clipped boxwood balls in low cream planters along the path edge; a brass mailbox mounted on a slim wood post to the right; warm interior glow reveals a brass pendant inside, a terracotta runner, and a folded cream wool throw on a vintage walnut bench. The sky is just-past-sunset — peach and rose at the horizon fading to a deep violet zenith, with a dramatic cloud bank on the left and a few stars beginning to appear in the upper sky; atmospheric haze softens the tree-line where mature oaks silhouette with visible individual branch detail. TWO of the same outdoor wall fixtures are mounted symmetrically on the brick — one each side of the arched surround — identical to the reference: compact matte-black rectangular wall sconce with thick matte-black aluminum frame wrapping a frosted white acrylic light panel, portrait orientation. Each occupies roughly 7% of the frame. Switched ON, emitting a soft warm 2700-3000K glow with a gentle wash on the brick around each sconce. The fixtures anchor without dominating. Custom-built residence, designer-inhabited.",
  },
  {
    slug: "v4_p2_4_paired_french_doors_backyard_evening_navy_brass_cream_dried_branch",
    ref: REF_P2,
    prompt:
      "A back facade French-door opening to a designed backyard, on a 35mm lens, eye-level, slight 3/4 right angle. A board-and-batten cedar facade in warm cream with paired French doors in dark-stained walnut with antique-brass hardware. ACCENT PALETTE — navy + brass + cream + dried branch: a large navy-glazed stoneware planter with a tall dried wisteria branch sits beside the doors; a folded cream wool throw drapes over the arm of a navy-cushioned outdoor bench facing the doors; a low brass tray on a small travertine plinth holds two cream pillar candles half-burned in brass holders; a worn-in navy outdoor rug on the bluestone patio shows subtle wear; clipped boxwood spheres in cream planters along the patio's edge; a brass-handled wicker tray with one open hardcover gardening book left face-down beside a pair of cream linen gardening gloves; warm interior glow visible through the glass reveals a brass pendant and a cream linen sectional. The sky is late evening with the fixture as primary light — deep navy zenith fading to a thin band of dusty rose at the horizon, with scattered broken cumulus and the silhouette of distant birds; faint ground-level mist over the lawn beyond. TWO of the same outdoor wall fixtures are mounted symmetrically on the cedar — one each side above the doors — identical to the reference: compact matte-black rectangular wall sconce with thick matte-black aluminum frame wrapping a frosted white acrylic light panel, portrait orientation. Each occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the cedar around each. The fixtures anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v4_p2_5_single_pool_house_blue_hour_forest_green_brass_walnut",
    ref: REF_P2,
    prompt:
      "A custom pool-house exterior wall on a 35mm lens, eye-level, slight 3/4 right angle. A smooth troweled stucco pool-house wall in warm cream meets a travertine pool deck in the foreground; the designed rectangular pool occupies the lower-left, its surface reflecting the warm sconce glow with realistic broken ripple. ACCENT PALETTE — forest green + brass + walnut + cream: a slim modern outdoor sectional in cream linen with two layered cushions in forest-green velvet and ivory bouclé and one folded walnut-and-brass-trim wool blanket sits along the wall; a round walnut-and-brass side table holds a half-full ceramic mug on a travertine coaster, an open hardcover landscape-design book left face-down, and a single sprig of olive in a brass vessel; one large forest-green-glazed stoneware planter with a mature fig tree anchors the right edge; clipped boxwood spheres in cream planters line the patio edge; a worn walnut-and-jute outdoor rug under the seating; a brass house-number plate on the stucco. The sky is deep blue hour — cool dominant tone with a thin warm peach band at the horizon, scattered broken altocumulus clouds across the upper sky, atmospheric haze near the tree-line where mature olive trees silhouette with visible branch detail. The single outdoor wall fixture is mounted high on the stucco above the sectional, identical to the reference — compact matte-black rectangular wall sconce with thick matte-black aluminum frame wrapping a frosted white acrylic light panel, portrait orientation. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow with a gentle wash on the stucco around the fixture. The fixture is sized to anchor without dominating. Custom residence, designer-inhabited.",
  },
  {
    slug: "v4_p2_6_paired_garage_facade_blue_hour_soft_blue_walnut_cream_brass",
    ref: REF_P2,
    prompt:
      "A wide custom-residence garage facade on a 28mm lens, eye-level, slight 3/4 right angle. Three modern wide oversize garage doors in dark-stained vertical-plank walnut, a smooth troweled stucco facade above in warm cream; an unlacquered-brass house-number plate centered between two of the doors. ACCENT PALETTE — soft blue + walnut + cream + brass: mature trimmed soft-blue lavender hedges line the foreground of the bluestone-paver driveway; a dark navy-blue late-model sedan parked at the right edge with one well-worn leather driving glove visible on the dashboard through the windshield; a slim walnut-and-brass mailbox on a wooden post; clipped boxwood balls in cream planters along the driveway edge; a folded soft-blue welcome mat at a small pedestrian side door; brass-framed wall-mounted bicycle hook visible on the side wall holding a vintage cream-painted bicycle; one large walnut-and-brass-trim planter with a mature fig tree at the right corner; a worn-in jute doormat at the side entry; faint warm interior glow leaking from beneath one garage door, suggesting it has just been left ajar. The sky is deep blue hour — periwinkle horizon with a thin warm band fading through pink to deep navy zenith, layered cumulus on the right and high cirrus across the upper frame, with the moon partially visible behind atmospheric haze. TWO of the same outdoor wall fixtures are mounted symmetrically on the stucco — one each side, evenly spaced between the garage doors — identical to the reference: compact matte-black rectangular wall sconce with thick matte-black aluminum frame wrapping a frosted white acrylic light panel, portrait orientation. Each occupies roughly 6% of the frame. Switched ON, soft warm 2700-3000K glow with a gentle wash on the stucco around each. The fixtures anchor without dominating; the long facade leads the eye. Architectural Digest custom-built residence.",
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
  const uniqueRefs = [...new Set(SCENES.map((s) => s.ref))];
  console.log(`Uploading ${uniqueRefs.length} unique reference image(s)...`);
  const refMap = new Map<string, string>();
  for (const ref of uniqueRefs) {
    const fname = path.basename(ref);
    const remoteUrl = await uploadRef(ref, `_scene-refs/${stamp}-v4-${fname}`);
    refMap.set(ref, remoteUrl);
    console.log(`  ${fname} -> ${remoteUrl}`);
  }

  const toRun = SCENES.filter((s) => {
    const outPath = path.join(outDir, `${s.slug}.png`);
    if (fs.existsSync(outPath)) { console.log(`  [skip] ${s.slug}`); return false; }
    return true;
  });
  if (toRun.length === 0) { console.log("Nothing to generate."); return; }

  console.log(`\nFiring ${toRun.length} tasks at ${RESOLUTION}...`);
  const tasks = await Promise.all(toRun.map(async (s) => {
    const taskId = await kieCreateTask(GUARDRAILS + s.prompt, refMap.get(s.ref)!);
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
