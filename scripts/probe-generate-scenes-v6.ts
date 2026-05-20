/**
 * v6 generator — full pool-based redo of the two indoor semi-flush products.
 * Tests the new pool library + camera variety enforcement + no-alcohol +
 * anti-convergence (zero room overlap across the two products) + per-category rules.
 *
 * Product A — crystal semi-flush (brushed brass + clear faceted prisms)
 * Product B — cream-petal semi-flush (walnut canopy + cream wavy petal shade)
 *
 * Each product gets 1 obvious room + 5 less-obvious rooms; the two product
 * room-sets do not overlap. Camera angle/height/distance varies across each 6.
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

const REF_CRYSTAL = path.join(os.tmpdir(), "scene", "ref5.jpg");
const REF_PETAL = path.join(os.tmpdir(), "scene", "p1", "p1_3.jpg");

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture in the reference image exactly — shape, proportions, finish, materials, silhouette. Do NOT invent a different fixture.

ONE SINGLE 1:1 photograph. No collage, grid, mood board. ZERO Mandarin / Chinese / Asian characters. No app chrome. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

`;

interface Scene { slug: string; ref: string; prompt: string; }

const SCENES: Scene[] = [
  // PRODUCT A — CRYSTAL SEMI-FLUSH (brushed brass + clear faceted prisms)
  // Rooms: stair landing (obvious) + walk-in dressing room, conservatory, window-seat alcove, music room, primary bathroom (5 less-obvious)
  // Camera angle: straight-on, 3/4-left, 3/4-right, depth axis, corner-of-room, looking-up
  {
    slug: "v6_A1_stair_landing_arched_window_navy_straight_on_low_wide",
    ref: REF_CRYSTAL,
    prompt:
      "Shot DEAD-ON STRAIGHT at a stair landing on a 28mm lens, camera at LOW seated height (~3.5 ft) looking up the staircase, framed WIDE. A coffered ceiling overhead; floor-to-ceiling steel-and-glass railing crosses the foreground; a tall arched window dominates the back wall pouring cool blue-hour light through scattered broken cloud onto the landing floor. ACCENT PALETTE — navy + brass + cream + dried branch: a hand-knotted navy-and-cream Persian runner with visible pile; a navy-velvet ottoman tucked under a vintage walnut console; a tall navy stoneware vase with a single dried wisteria branch on the windowsill; a stack of two cream-spined design books with brass bookends; a cream linen throw draped over a small wooden bench; a brass-rimmed leaning antique mirror on the side wall; a small brass-and-tortoise clock on the console; warm-dimmed brass-housed recessed cans glow in the coffered ceiling. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the coffered ceiling, one E27 bulb visible. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. The fixture is sized to anchor without dominating; the staircase and arched window lead the eye. Architectural Digest custom residence.",
  },
  {
    slug: "v6_A2_walk_in_dressing_room_plum_3qtr_left_eye_level_medium",
    ref: REF_CRYSTAL,
    prompt:
      "Shot from a STRONG 3/4 LEFT angle on a 35mm lens at STANDING eye-level (~5.5 ft), framed MEDIUM. A custom walk-in dressing room with a center honed-marble island and built-in cream-painted oak cabinetry on the back wall, louvered doors with brass cup pulls rising the full height. ACCENT PALETTE — plum + cream + brass + walnut: a stack of three folded plum cashmere sweaters on the marble island beside a brass-and-leather jewelry box; a small plum-velvet ring tray; a bouquet of dried plum and cream hydrangeas in a low brass vase; a cream-leather perfume tray with three crystal flacons; an open louvered door revealing folded cream linen shirts with plum-bound hangers; a brass-trimmed full-length mirror leaning against the side wall; a vintage plum-velvet bench tucked against the right wall with a folded cream cashmere wrap; a plum-and-cream Persian rug under the island showing fine pile texture; warm-dimmed brass-housed recessed cans. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the ceiling, one E27 bulb visible. Occupies roughly 11% of the frame. Switched ON, soft warm 2700-3000K glow. The fixture is sized to anchor without dominating; the cabinetry and island lead the eye. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_A3_conservatory_forest_green_camera_up_wide",
    ref: REF_CRYSTAL,
    prompt:
      "Shot on a 28mm lens at standing eye-level, camera TILTED UP 10 DEGREES to capture the vaulted glass-paneled ceiling overhead with cream-painted wood framing, framed WIDE. A custom conservatory / glass-walled garden room; floor-to-ceiling steel-and-glass walls reveal a clear pale-gold late-afternoon sky with faint atmospheric haze beyond mature oak silhouettes. ACCENT PALETTE — forest green + brass + walnut + cream: a deep cream-rattan sectional with forest-green linen cushions and a folded walnut-and-brass-trim wool throw casually draped over one arm; a low round walnut coffee table holds a brass-handled watering can, a stack of two gardening monographs spine-out, a stoneware ramekin of pruning shears, and a cream ceramic pitcher of cut wildflowers; a large fig tree in a terracotta pot at the corner; a smaller potted olive tree beside the sectional; rows of leafy herbs in cream pots line a long built-in stone planter at the glass-wall base; a hand-knotted jute-and-cream rug under the seating with visible fiber texture. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, mounted at a beam intersection of the glass roof, one E27 bulb visible. Occupies roughly 7% of the frame. Switched ON, soft warm 2700-3000K accent within the bright afternoon light. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_A4_window_seat_alcove_soft_blue_3qtr_right_low_tight",
    ref: REF_CRYSTAL,
    prompt:
      "Shot from a 3/4 RIGHT angle on a 50mm lens at LOW SEATED height (~3 ft), framed TIGHT on a deep-set window-seat alcove built into a walnut bookshelf wall. Floor-to-ceiling walnut shelves frame the alcove on three sides, dense with leather-bound books; a slim arched window above the seat shows clear late-evening blue light with a partial moon just visible beyond mature oak silhouettes. ACCENT PALETTE — soft blue + walnut + cream + brass: a cream linen cushion runs the length of the seat with two layered pillows in soft-blue velvet and cream bouclé; a folded cream cashmere throw with a knitted edge; an open hardcover novel left face-down on the cushion with a brass-and-tortoise pair of round reading glasses laid on the open page; a built-in walnut shelf beside the seat holds a stack of three soft-blue-bound poetry books, a half-burned cream beeswax taper in a small brushed-brass holder, a ceramic mug on a cork coaster, and a small brass alarm clock; warm-dimmed brass cove lighting glows behind a top valance. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the ceiling above the alcove, one E27 bulb visible. Occupies roughly 18% of the frame. Switched ON, soft warm 2700-3000K glow as the dominant light source. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_A5_music_room_burgundy_through_doorway_eye_level_wide",
    ref: REF_CRYSTAL,
    prompt:
      "Shot on a 28mm lens at standing eye-level (~5.5 ft), camera positioned in the doorway of an adjacent hallway LOOKING DOWN A DEPTH AXIS through an archway into a custom music room beyond. The cased archway is visible in the foreground framing the scene; a coffered ceiling rises overhead in the music room. ACCENT PALETTE — burgundy + walnut + cream + brass: a walnut grand piano dominates the room with its lid raised, a brass-stemmed piano lamp clamped to its side; a stack of cream-bound sheet music open on the music rest; a burgundy velvet piano shawl draped over the lid; a vintage burgundy-velvet chaise against the side wall with a folded cream cashmere throw; a small walnut side table holds an open hardcover music-history book and a brass-cornered metronome; a hand-knotted burgundy-and-cream Persian rug under the piano with fine pile texture; a large brass-framed leaning vintage portrait against the back wall; warm-dimmed brass-housed recessed cans. The ceiling fixture is mounted above the piano, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the coffered ceiling, one E27 bulb visible. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding coffered ceiling. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_A6_primary_bathroom_forest_green_corner_eye_level_medium",
    ref: REF_CRYSTAL,
    prompt:
      "Shot from a CORNER OF THE ROOM with TWO WALLS VISIBLE on a 35mm lens at eye-level (~5.5 ft), framed MEDIUM. A spa-tier primary bathroom with honed-Calacatta marble slab walls wrapping two sides of the room, subtle veining visible. ACCENT PALETTE — forest green + cognac + brass + cream: a curved freestanding bathtub sits in the corner with a small brass-rim caddy holding a folded cream linen washcloth, an open hardcover landscape-design book left face-down, and a small forest-green ceramic vessel with one sprig of olive; a vintage cognac-leather slipper chair against the far wall with a folded cream cashmere throw and one cream waffle-weave robe draped over its arm; a slim brass-and-walnut floor lamp (switched off) beside the chair; a hand-knotted forest-green-and-cream Persian rug on the herringbone wood floor beside the marble; a small framed antique botanical of a fern leans against the marble wall on a low brass-and-marble shelf; warm-dimmed brass-housed recessed cans glow in the coffered ceiling. The ceiling fixture is mounted above the tub, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the coffered ceiling, one E27 bulb visible. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding marble. The fixture is sized to anchor without dominating; the marble walls and tub lead the eye. Designer-inhabited custom residence.",
  },

  // PRODUCT B — CREAM-PETAL SEMI-FLUSH (walnut canopy + cream wavy petal shade)
  // Rooms: small entryway (obvious) + breakfast nook, library reading nook, mudroom, butler's pantry, craft/sewing room (5 less-obvious)
  // Zero room overlap with Product A. Camera angle: straight-on, 3/4-left, 3/4-right, depth axis, looking-up, corner
  {
    slug: "v6_B1_breakfast_nook_butter_yellow_straight_on_low_tight",
    ref: REF_PETAL,
    prompt:
      "Shot DEAD-ON STRAIGHT at a custom breakfast nook on a 50mm lens at LOW SEATED height (~3.5 ft), framed TIGHT. A built-in cream-painted curved banquette wraps a three-panel bay, upholstered in oatmeal linen with two scattered cushions in butter-yellow and pale-olive bouclé; a round honed-Calacatta-marble pedestal table in the bay. ACCENT PALETTE — butter yellow + cream + brass + olive: on the marble table, two cream ceramic breakfast plates with crumbs of toast, a small antique-brass tray holding a half-full glass carafe of juice and a slim glass tumbler, a small pale-olive ceramic bowl of stone fruit, a butter-yellow linen napkin loosely folded, an open hardcover cookbook left face-down with a sprig of rosemary as a bookmark, a brass-handled ceramic teapot, a small cream-glazed vase with three garden roses; a worn-in oatmeal-and-butter-yellow Persian rug on the herringbone white-oak floor. The bay's three arched casement windows show a clear bright morning sky with horizon haze beyond mature trees with visible branch detail. The ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with irregular scalloped bottom petals, one E27 bulb visible. Occupies roughly 15% of the frame. Switched ON, soft warm 2700-3000K accent. The fixture is sized to anchor without dominating; the banquette and bay lead the eye. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_B2_library_reading_nook_burgundy_3qtr_left_eye_seated_medium",
    ref: REF_PETAL,
    prompt:
      "Shot from a STRONG 3/4 LEFT angle on a 35mm lens at EYE-LEVEL SEATED height (~3.5-4 ft), framed MEDIUM. A reading nook tucked into a built-in walnut bookshelf alcove with floor-to-ceiling walnut shelves on three sides, dense with leather-bound books in tobacco, ochre, and burgundy with brass spine bands; a rolling brass-and-walnut library ladder rests against the shelves. ACCENT PALETTE — burgundy + walnut + cream + brass: a vintage cognac-leather club chair angled in the corner with a folded burgundy wool throw over its arm; a low walnut side table holds a brass-banded reading lamp (switched off), a half-full ceramic mug on a small brass coaster, an open hardcover book left face-down with a pair of round wire-rim reading glasses on the page, a small burgundy ceramic vessel with a single dried thistle, and a brass alarm clock; a hand-knotted burgundy-and-cream Persian rug on the herringbone walnut floor; a brass-framed leaning pencil sketch against the bookshelf base; one burgundy-cushioned ottoman doubling as footrest. Warm-dimmed brass cove lighting glows behind a top crown moulding. The ceiling fixture is mounted overhead, identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals, one E27 bulb visible. Occupies roughly 13% of the frame. Switched ON, soft warm 2700-3000K glow. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_B3_mudroom_storage_wall_soft_blue_3qtr_right_eye_level_wide",
    ref: REF_PETAL,
    prompt:
      "Shot from a 3/4 RIGHT angle on a 35mm lens at STANDING eye-level (~5.5 ft), framed WIDE. A custom mudroom with a full back wall of built-in cream-painted oak cubbies featuring brass label plates, mid-height brass coat hooks, and a slatted upper shelf; stone-tile floor in soft warm grey limestone with visible mortar lines. ACCENT PALETTE — soft blue + walnut + cream + brass: a vintage walnut-and-brass bench across the foreground with a cream linen cushion runner and two soft-blue striped seat pillows; underneath the bench a pair of well-worn brown leather riding boots, a pair of cream canvas sneakers, and a child-sized pair of soft-blue rain boots tucked side by side; on the brass coat hooks a navy work jacket, a chambray apron, a soft-blue scarf, and a leather tote leaning open; the upper slatted shelf displays cream wicker baskets, a stack of folded cream linen towels, a soft-blue ceramic pitcher with cut hydrangeas, a brass house-number plate, and a small walnut bowl of pet treats; a soft-blue-and-cream Persian runner under the bench with visible wear. A tall arched window to one side shows a clear morning sky with broken cumulus clouds. The ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to a tray ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupies roughly 10% of the frame. Switched ON, soft warm 2700-3000K accent. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_B4_butler_pantry_sage_through_doorway_eye_level_wide",
    ref: REF_PETAL,
    prompt:
      "Shot on a 28mm lens at standing eye-level (~5.5 ft) positioned at the threshold of a butler's pantry, camera LOOKING DOWN A DEPTH AXIS through the cased opening into the scullery beyond, framed WIDE. The cased opening in foreground frames the view; a tray ceiling rises overhead in the pantry; open walnut shelves rise along the right wall lined with cream ironstone pitchers, brass-rim glass water tumblers, and stacked white-and-cream ceramic dinnerware. ACCENT PALETTE — sage + brass + cream + walnut: a soapstone counter runs the back of the pantry with a brass faucet over a small prep sink; a brass-bound wood cutting board with a half-loaf of crusty bread, a small ceramic crock of wooden utensils, a sage-glazed ceramic bowl of citrus, and a linen tea towel embroidered with sage botanical motifs; a stack of folded cream linen tea towels on the counter; a slim brass hand-press lemon squeezer; a pair of brass salt cellars beside a small glass pepper grinder; a small framed botanical of a sage fern leans against the back wall; the kitchen visible beyond shows the corner of a marble waterfall island. Warm-dimmed brass-housed recessed cans glow. The ceiling fixture is mounted overhead in the pantry, identical to the reference — slim round walnut-wood canopy flush to the tray ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor of the pantry. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_B5_craft_room_dusty_pink_camera_up_wide",
    ref: REF_PETAL,
    prompt:
      "Shot on a 28mm lens at standing eye-level, camera TILTED UP 12 DEGREES to capture an exposed white-painted reclaimed-oak beam ceiling overhead in a custom craft / sewing room, framed WIDE. Tall paneled walls in soft warm cream with subtle pale-pink-blush wash; the back wall lined with built-in cream-painted oak cubbies holding rolled bolts of cream and sage linen and stacked spools of cotton thread in graduated colors. ACCENT PALETTE — dusty pink + cream + brass + sage: a vintage walnut sewing table dominates the foreground holding a brass-trim vintage Singer sewing machine in cream-painted enamel, a small ceramic vessel of antique-brass thimbles and dressmaker scissors, a folded swatch of dusty-pink linen with a tape measure draped over it, a brass-bound sample book of fabric swatches in pink and sage; a built-in cream-painted oak shelf along the side wall holds a stack of three vintage pattern books, a ceramic crock of brass-and-wood thread spools, and a small dusty-pink ceramic vase with a single dried hydrangea; a cream-painted Windsor chair tucked at the sewing table with a folded sage linen pinafore over its back; a hand-knotted dusty-pink-and-cream Persian rug under the table. A clerestory window high on the back wall shows a clear morning sky with horizon haze. The ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to the beam ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v6_B6_small_entryway_arched_door_brass_cognac_corner_elevated_medium",
    ref: REF_PETAL,
    prompt:
      "Shot from a CORNER OF THE ROOM with TWO WALLS VISIBLE on a 35mm lens at slightly ELEVATED height (~6 ft), framed MEDIUM. A custom small entryway with a Roman-arched doorway framing the back of the room with a recessed cream-painted wood door with antique-brass hardware; the floor is hand-cut soft-grey limestone tile with broken-edge texture; tall cream-lacquered paneled walls. ACCENT PALETTE — brass + cognac + sage: a vintage cognac-leather bench along the right wall with one folded sage wool throw draped over the arm and a stack of two design books on the seat; a vintage walnut console along the left wall holds a small cream ceramic vessel with a single olive branch, a brass-and-leather lined dish with two house keys, a folded cream linen tea towel, a small framed botanical of a sage-green fern leaning against the wall, and a half-burned cream beeswax taper in a brushed-brass candleholder; a sage canvas tote leans against the wall beside the bench; a pair of well-worn cognac leather loafers tucked underneath; a brass-trimmed antique gilt mirror leans above the console rather than hanging; a hand-knotted cream-and-sage runner overlapping the limestone tile shows fine wear. Warm-dimmed brass-housed sconces flank the arched doorway. The ceiling fixture is mounted overhead, identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupies roughly 12% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor. The fixture is sized to anchor without dominating; the arched doorway and console lead the eye. Designer-inhabited custom residence.",
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
    const remoteUrl = await uploadRef(ref, `_scene-refs/${stamp}-v6-${fname}`);
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
