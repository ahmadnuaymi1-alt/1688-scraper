/**
 * v5 generator — applies the three corrective skill refinements:
 *   1. Soft sky (ONE condition per scene, no stacking)
 *   2. Anti-convergence (≤2 obvious + ≥3 less-obvious per product; no room repeat across products)
 *   3. Realism / logic sanity check (full architectural context per scene)
 *
 * Side-by-side test: same crystal semi-flush (851894641642, brass variant)
 * vs. cream-petal walnut semi-flush (859243174764). Same category, must
 * produce non-overlapping room mixes.
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

const REF_CRYSTAL = path.join(os.tmpdir(), "scene", "ref5.jpg");      // brass crystal square semi-flush
const REF_PETAL = path.join(os.tmpdir(), "scene", "p1", "p1_3.jpg");  // cream-petal walnut semi-flush

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture in the reference image exactly — shape, proportions, finish, materials, silhouette. Do NOT invent a different fixture.

ONE SINGLE 1:1 photograph. No collage, grid, mood board. ZERO Mandarin / Chinese / Asian characters. No app chrome. NO HUMANS, NO PETS — implied presence only.

`;

interface Scene { slug: string; ref: string; prompt: string; }

const SCENES: Scene[] = [
  // =====================================================
  // PRODUCT A — Crystal semi-flush (brushed brass + clear faceted-prism cage, single E27)
  // Room mix: 1 obvious (stair landing) + 5 less-obvious (powder, walk-in, sitting area, library nook, wine alcove)
  // =====================================================
  {
    slug: "v5_A1_crystal_powder_room_statement_wallpaper",
    ref: REF_CRYSTAL,
    prompt:
      "A custom powder room shot dead-on a 50mm lens, eye-level, perpendicular to a back wall hung in deep emerald-green grasscloth wallpaper with subtle metallic-thread veining. Honed white-Carrara marble vanity counter floats on a slim brushed-brass bracket below an antique-brass arched mirror; a single chiseled-bronze vessel sink sits centered, an antique-brass single-handle faucet rises behind it. ACCENT PALETTE — emerald + brass + cream + bronze: a stack of two cream linen hand towels with embroidered emerald monograms on a small antique-brass tray, a green-glass ribbed apothecary bottle, a small emerald-bound poetry book left face-down on a corner of the counter, a brass-handled hairbrush, a hand-painted ceramic dish holding a single rose-quartz crystal. A vintage emerald-velvet stool tucked beneath the counter. Honed-travertine floor with a tightly-woven cream wool runner showing fine wear; deep wainscoting in cream lacquer; antique-brass picture-light above a small framed pencil sketch on the side wall. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, top and bottom frames in matching brass, round brushed-brass canopy flush to the ceiling, one E27 bulb visible. Occupying roughly 14% of the frame. Switched ON, soft warm 2700-3000K glow on the cream-lacquer ceiling. Fixture sized to anchor without dominating. Architectural Digest custom residence.",
  },
  {
    slug: "v5_A2_crystal_walk_in_dressing_room_island",
    ref: REF_CRYSTAL,
    prompt:
      "A custom walk-in dressing room on a 35mm lens, eye-level, slight 3/4 right angle. A center walnut-and-brass island with a honed-marble top occupies the foreground, a built-in cream-painted cabinetry wall of louvered doors and brass cup pulls rises the full height of the back wall. ACCENT PALETTE — plum + cream + brass + walnut: on the marble island, a stack of three folded plum cashmere sweaters with a brass-and-leather jewelry box on top, a small plum-velvet ring tray, a bouquet of dried plum and cream hydrangeas in a low brass vase, a cream-leather perfume tray with three crystal flacons; on the back wall, an open louvered door reveals folded cream linen shirts in stacks with plum-bound hangers; a brass-trimmed full-length mirror leans against the side wall; a vintage plum-velvet bench tucked against the right wall with a folded cream cashmere wrap; wide-plank honed-walnut floor with a plum-and-cream Persian rug centered under the island showing fine pile texture; warm-dimmed brass-housed recessed cans glow. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the ceiling, one E27 bulb visible. Occupying roughly 12% of the frame. Switched ON, soft warm 2700-3000K glow. The fixture is sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_A3_crystal_sitting_area_within_primary_suite",
    ref: REF_CRYSTAL,
    prompt:
      "A sitting area tucked into the bay of a primary suite, on a 35mm lens, eye-level, wide framing into the bay. A tray ceiling above with thin painted reveal trim; three tall arched casement windows form the bay, dressed in cream linen drapes pulled to one side. Late-afternoon light comes through scattered broken cloud outside. ACCENT PALETTE — terracotta + cream + brass + olive: a vintage cognac leather slipper chair faces a cream linen chaise; a low round walnut coffee table holds a stack of two design monographs spine-out, a terracotta ceramic vessel with a single olive branch, a brass-rimmed coaster with a half-full ceramic mug, and a folded terracotta wool throw casually draped over the chair arm; a cream-and-terracotta vintage Persian rug grounds the seating; a large olive tree in a terracotta pot anchors the corner; a small brass-framed leaning oil sketch sits against the wall beneath the windows; a wall-mounted brass picture-light glows above a small framed photograph. The ceiling fixture is mounted in the bay overhead, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass frames, round brass canopy flush to the tray ceiling, one E27 bulb visible. Occupying roughly 11% of the frame. Switched ON, soft warm 2700-3000K accent within the bright afternoon light. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_A4_crystal_library_wall_corner_leather_club",
    ref: REF_CRYSTAL,
    prompt:
      "A library-wall corner of a custom-built study on a 35mm lens, eye-level seated, slight 3/4 left angle. Floor-to-ceiling built-in walnut shelving rises the full height of the back wall, dense with leather-bound books in tobacco and ochre with brass spine bands; a rolling brass-and-walnut library ladder rests against the shelves. ACCENT PALETTE — forest green + cognac + brass + cream: a vintage cognac-leather club chair angled in the corner with a folded forest-green wool throw over its arm; a low walnut side table beside the chair holds a brass-banded reading lamp (switched off, decorative), a half-full ceramic mug on a small brass coaster, an open hardcover book left face-down with a pair of round wire-rim reading glasses on the page, and a forest-green ceramic vessel with a single dried thistle; a cream-and-forest-green Persian rug on the herringbone walnut floor; a brass-framed leaning pencil sketch against the bookshelf base; one forest-green-cushioned ottoman doubling as a footrest. Warm-dimmed brass-housed cove lighting glows behind a top crown moulding. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass frames, round brass canopy flush to the ceiling, one E27 bulb visible. Occupying roughly 13% of the frame. Switched ON, soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_A5_crystal_wine_tasting_alcove_stone",
    ref: REF_CRYSTAL,
    prompt:
      "A small wine-tasting alcove on a 35mm lens, eye-level, slight 3/4 right angle. Honed-limestone vaulted ceiling overhead with subtle veining; honed-fieldstone back wall with mortar joints visible; arched openings frame floor-to-ceiling refrigerated wine storage racks of dark walnut, bottles visible. ACCENT PALETTE — burgundy + walnut + cream + brass: a small round walnut-and-brass bistro table in the foreground holds two crystal Bordeaux glasses with a finger of wine, a half-eaten wedge of aged Manchego on a slate plate, a cream linen napkin loosely folded with a brass napkin ring, a corkscrew with a walnut handle, an open hardcover wine atlas left face-down, and a stoneware ramekin of olives; a vintage walnut-and-burgundy-velvet bistro chair tucked under one side; a smaller stool with a burgundy leather seat opposite; a brass-and-walnut wall rack of three vintage corks above the table; an antique brass-framed map of Bordeaux leans against the stone wall; a brass-handled ice bucket on the floor beside the chair. The ceiling fixture is centered above the table, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass frames, round brass canopy flush to the limestone-vault ceiling, one E27 bulb visible. Occupying roughly 13% of the frame. Switched ON, soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_A6_crystal_stair_landing_arched_window",
    ref: REF_CRYSTAL,
    prompt:
      "A stair landing with a feature arched window, on a 28mm lens, eye-level, slight 3/4 left angle, framed wide. A coffered ceiling overhead; paneled walls in soft warm white; the half-turn of the staircase visible at the lower-right with a steel-and-glass railing connecting to a wide-plank quarter-sawn white-oak floor that stretches across the landing. ACCENT PALETTE — soft blue + walnut + cream + brass: a small mid-century walnut-and-cane reading chair tucked in the corner with a folded soft-blue wool throw across its seat; a vintage walnut side table beside it holds one half-burned cream beeswax taper in a brushed-brass candleholder and a small ceramic vessel with one olive branch; a soft-blue-and-cream Persian rug on the landing showing fine pile texture; a large leaning piece of muted-abstract art in a slim brass frame against the back wall; a brass-trimmed full-length mirror leans against the side wall above a small stack of two cream-bound design books. The tall arched window above the stairwell shows a clear cool morning sky with a faint horizon haze across distant treetops. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass frames, round brass canopy flush to the coffered ceiling, one E27 bulb visible. Occupying roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow. Architectural Digest custom residence.",
  },

  // =====================================================
  // PRODUCT B — Cream-petal walnut semi-flush (cream wavy/ribbed petal shade + walnut canopy, single E27)
  // Room mix (DIFFERENT from A): 1 obvious (small entry) + 5 less-obvious (breakfast nook, sunroom, reading nook, bar nook, mudroom)
  // =====================================================
  {
    slug: "v5_B1_petal_breakfast_nook_bay_window_morning",
    ref: REF_PETAL,
    prompt:
      "A breakfast nook with a three-panel bay window on a 35mm lens, eye-level seated, slight 3/4 left angle. A built-in cream-painted curved banquette wraps the bay, upholstered in oatmeal linen with two scattered cushions in butter yellow and pale-olive bouclé; a round honed-Calacatta-marble pedestal table in the bay shows fine veining. ACCENT PALETTE — butter yellow + cream + brass + olive: on the marble table, two cream ceramic breakfast plates with crumbs of toast, a small antique-brass tray holding a half-full glass carafe of orange juice and a slim glass tumbler, a small pale-olive ceramic bowl of stone fruit, a butter-yellow linen napkin loosely folded, an open hardcover cookbook left face-down with a sprig of rosemary as a bookmark, a brass-handled ceramic teapot, a small cream-glazed vase with three garden roses; a worn-in oatmeal-and-butter-yellow Persian rug on the herringbone white-oak floor. The bay's three arched casement windows show a clear bright morning sky with horizon haze, mature trees beyond with individual branch detail. A small framed botanical print leans against the windowsill. The ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped bottom petals, one E27 bulb visible. Occupying roughly 12% of the frame. Switched ON, soft warm 2700-3000K accent. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_B2_petal_sunroom_conservatory_afternoon",
    ref: REF_PETAL,
    prompt:
      "A custom sunroom / conservatory on a 28mm lens, low eye-level, slight 3/4 right angle, framed wide. A vaulted glass-paneled ceiling above with cream-painted wood framing; floor-to-ceiling steel-and-glass walls reveal a clear pale-gold late-afternoon sky beyond with faint atmospheric haze. ACCENT PALETTE — forest green + cream + terracotta + jute: a deep jute-and-cream-rattan sectional with terracotta linen cushions and a folded forest-green wool throw casually draped over one arm; a low round walnut coffee table holds a brass-handled watering can, a stack of two gardening monographs spine-out, a stoneware ramekin of pruning shears, a cream ceramic pitcher of cut wildflowers, and a small terracotta dish with one cream tea light burning; a large fig tree in a terracotta pot at the corner; a smaller potted olive tree beside the sectional; rows of leafy herbs in cream pots line a long built-in stone planter at the base of the glass wall; a hand-knotted jute-and-cream rug under the seating with visible fiber texture; a wicker basket of folded gardening throws beside the sofa. The ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to a beam intersection of the glass roof, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupying roughly 9% of the frame. Switched ON, soft warm 2700-3000K accent within the bright afternoon light. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_B3_petal_reading_nook_bookshelf_alcove_evening",
    ref: REF_PETAL,
    prompt:
      "A reading nook tucked into a built-in walnut bookshelf alcove, on a 50mm lens, eye-level seated, dead-on framing. Floor-to-ceiling walnut bookshelves frame the alcove on three sides, dense with leather-bound books and pottery, a brass library ladder visible on the left edge. ACCENT PALETTE — burgundy + walnut + cream + brass: a deep-set window seat with a cream linen cushion and two layered pillows in burgundy velvet and cream bouclé; a folded cream cashmere throw on the seat with a knitted edge; an open hardcover novel left face-down on the cushion with a brass-and-tortoise pair of round reading glasses laid on the open page; a small built-in walnut shelf beside the seat holds a stack of three burgundy-bound poetry books, a half-burned cream beeswax taper in a small brushed-brass holder, a ceramic mug on a cork coaster with steam visible, and a small brass alarm clock; a slim arched window above the seat shows late-evening light with a partial moon just visible through a thin band of horizon haze beyond mature oak silhouettes; warm-dimmed brass cove lighting glows behind a top valance. The ceiling fixture is mounted directly above the seat overhead, identical to the reference — slim round walnut-wood canopy flush to the ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupying roughly 16% of the frame. Switched ON, soft warm 2700-3000K glow as the dominant light source. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_B4_petal_bar_nook_off_dining_evening",
    ref: REF_PETAL,
    prompt:
      "A custom wet-bar nook tucked off a dining room, on a 35mm lens, eye-level, slight 3/4 right angle. A back wall of antique-mirrored panels with a deep walnut counter and floating walnut shelves stocked with crystal decanters and amber spirit bottles; a honed black-marble counter with subtle gold veining runs the length of the bar. ACCENT PALETTE — navy + brass + walnut + cream: on the counter, a brushed-brass ice bucket with two crystal lowball glasses, a cream linen bar towel folded neatly, an open cocktail-recipe book left face-down with a navy-leather bookmark, a small wooden bowl of cocktail cherries, a navy ceramic small dish of citrus twists, a pair of antique-brass cocktail strainers in a slim walnut tray, a stack of two cream-spined cocktail monographs; two navy-leather counter stools tucked under the bar; a brass-framed leaning vintage cocktail-poster print against the side wall; warm-dimmed brass sconces flank the back-bar shelves (visible glow rather than fixture). A herringbone walnut floor with a navy-and-cream Persian runner. The ceiling fixture is mounted overhead in the nook, identical to the reference — slim round walnut-wood canopy flush to the ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupying roughly 13% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_B5_petal_mudroom_storage_wall_morning",
    ref: REF_PETAL,
    prompt:
      "A custom mudroom on a 35mm lens, eye-level, straight-on framing. A full back wall of built-in cream-painted oak cubbies with brass label plates, mid-height brass coat hooks, and a slatted upper shelf; a stone-tile floor in soft warm grey limestone with visible mortar lines. ACCENT PALETTE — soft blue + walnut + cream + brass: a vintage walnut-and-brass bench across the foreground with a cream linen cushion runner and two soft-blue striped seat pillows; underneath the bench, a pair of well-worn brown leather riding boots, a pair of cream canvas sneakers, and a child-sized pair of soft-blue rain boots tucked side by side; on the brass coat hooks, a navy work jacket, a chambray apron, a soft-blue scarf, a woven straw sun hat, and a leather tote leaning open; the upper slatted shelf displays cream wicker baskets, a stack of folded cream linen towels, a soft-blue ceramic pitcher with cut hydrangeas, a brass house-number plate, and a small walnut bowl of dog biscuits; a small framed family photograph in a brass frame leans against the back of the shelf; a soft-blue-and-cream Persian runner under the bench with visible wear. A tall arched window to one side shows a clear morning sky with broken cumulus clouds. The ceiling fixture is identical to the reference — slim round walnut-wood canopy flush to a tray ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupying roughly 12% of the frame. Switched ON, soft warm 2700-3000K accent. Designer-inhabited custom residence.",
  },
  {
    slug: "v5_B6_petal_small_arched_side_entry_evening",
    ref: REF_PETAL,
    prompt:
      "A small custom side entry hall on a 35mm lens, eye-level, slight 3/4 right angle. A Roman-arched doorway frames the back of the room with a recessed cream-painted wood door with antique-brass hardware; the floor is hand-cut soft-grey limestone tile with broken-edge texture; tall cream-lacquered paneled walls. ACCENT PALETTE — sage green + brass + walnut + cream: a vintage walnut console along the right wall holds a small cream ceramic vessel with a single olive branch, a brass-and-leather lined dish with two house keys, a folded cream linen tea towel, a small framed botanical of a sage-green fern leaning against the wall, and a half-burned cream beeswax taper in a brushed-brass candleholder; a sage-green canvas tote leans against the wall beside the console; a pair of well-worn cognac leather loafers tucked underneath; a brass-trimmed antique gilt mirror leans above the console rather than hanging; a small cream-and-sage hand-knotted runner overlapping the limestone tile shows fine wear; warm-dimmed brass-housed sconces flank the arched doorway. The ceiling fixture is mounted overhead, identical to the reference — slim round walnut-wood canopy flush to the coffered ceiling, suspended on a short walnut stem, cream wavy/ribbed petal-shaped resin shade with scalloped petals, one E27 bulb visible. Occupying roughly 14% of the frame. Switched ON, soft warm 2700-3000K glow as the warm anchor of an early-evening interior. Designer-inhabited custom residence.",
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
    const remoteUrl = await uploadRef(ref, `_scene-refs/${stamp}-v5-${fname}`);
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
