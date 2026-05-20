/**
 * v9 — strict-pool-sampling + revised "visible but soft" window rule.
 * Product: brushed-brass crystal-cage semi-flush (851894641642).
 *
 * POOL SAMPLE: lines 202, 234, 241, 261, 313, 410 (passed first attempt; 2 obvious within cap)
 * CAMERA ASSIGNMENT:
 *   L202 → T3 (3/4 RIGHT)        | Provençal bedroom
 *   L234 → T1 (WIDE)              | Mediterranean primary bedroom
 *   L241 → T4 (DEPTH-AXIS)        | Mountain modern lodge bedroom
 *   L261 → T2 (3/4 LEFT)          | Modern farmhouse hallway [POTTERY-BARN]
 *   L313 → T6 (TIGHT VIGNETTE)    | French country entry
 *   L410 → T5 (LOW ANGLE UP)      | Reading nook with built-in bench and bay window
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

const REF = path.join(os.tmpdir(), "scene", "ref5.jpg");

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the ceiling, one E27 bulb visible inside.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS — visible but soft: window shows real trees, hedges, branches, or landscape with pale soft sky beyond. Brighter than the interior, but NOT pure white blown-out. Soft natural rolloff. Exterior detail slightly softer than the interior. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies, painted-backdrop CGI effect.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // L202 → T3 — Provençal bedroom, late afternoon spring
  {
    slug: "v9_L202_T3_provencal_bedroom_3qtr_right_late_afternoon_spring",
    prompt:
      "TREATMENT 3 — STRONG 3/4 RIGHT ANGLE. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the RIGHT of center showing two walls of a Provençal bedroom at a 35° angle, framed medium. POOL ANCHOR (Line 202): Provençal bedroom with rough plaster walls and limestone floor + bleached oak bed and lavender bunches + Provençal — late afternoon spring. Rough whitewashed plaster walls with subtle hand-troweled texture; pale honey-toned limestone tile floor; exposed lime-washed wooden beams overhead. ACCENT PALETTE — soft lavender + cream + brass + bleached oak: a bleached-oak slatted bed against the back wall with layered linen bedding in cream and ivory intentionally rumpled (not made, not messy); two bundles of fresh lavender stems on a brass-bound wood tray on the duvet; a slim woven straw market basket beside the bed holding more lavender; a vintage bleached-oak nightstand at the left holds a small cream stoneware vessel with three sprigs of olive, a stack of two leather-bound cream poetry books with brass bookends, a half-burned cream beeswax taper in an antique-brass holder, and a small brass alarm clock; a Provençal pale-blue-and-cream toile cushion on a low rush-seat chair tucked in the corner with a folded soft-lavender wool throw; a hand-woven jute rug atop the limestone with fine fiber texture; a brass-framed leaning watercolor of a lavender field against the side wall. A small deep-set window on the right wall shows soft late-afternoon spring daylight: visible green-grey olive trees and pale-blue sky beyond with light atmospheric haze, exterior slightly softer than the interior but trees recognizable, gentle bright rolloff. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the beamed ceiling, one E27 bulb visible. Occupies roughly 11% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding plaster ceiling. Sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  // L234 → T1 — Mediterranean primary bedroom, golden hour summer
  {
    slug: "v9_L234_T1_mediterranean_primary_bedroom_wide_golden_hour",
    prompt:
      "TREATMENT 1 — WIDE ESTABLISHING SHOT. 28mm lens at standing eye-level (~5.5 ft), straight-on framing pulled back to show the full Mediterranean primary bedroom as the hero; fixture small in the upper portion of the frame. POOL ANCHOR (Line 234): Mediterranean primary bedroom with vaulted plaster ceiling and limestone floor + cream linen tufted bed and olive branch + Mediterranean — golden hour summer. A vaulted whitewashed plaster ceiling rises overhead with thin painted exposed wood beams; honey limestone tile floor; thick lime-washed plaster walls with deep window reveals. ACCENT PALETTE — terracotta + cream + brass + olive: an oversized cream linen tufted upholstered bed centered on the back wall with layered bedding in cream and ivory linen intentionally rumpled, a hand-loomed wool blanket in terracotta-and-cream draped at the foot, two layered cushions in cream bouclé and rust velvet; a vintage walnut nightstand at the left holds a stoneware vessel with a single substantial olive branch, a stack of two cream-bound design books with brass bookends, and a brass alarm clock; a mirroring nightstand at the right with a small ceramic dish of stone-fruit, a brass-handled hand mirror, and a half-burned beeswax taper in a brass holder; a long terracotta-cushioned bench at the foot of the bed with a folded cream wool throw; a hand-knotted terracotta-and-cream Persian rug grounds the bed; a brass-framed leaning antique olive-grove oil painting against the side wall above a small walnut credenza. A tall arched window on the right wall in deep-set plaster casing shows soft golden-hour summer light: visible warm-lit green olive trees and pale-gold sky with light haze beyond, exterior soft but recognizable, gentle bright rolloff from the window into the room. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the vaulted ceiling, one E27 bulb visible. Occupies roughly 7% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding plaster. Sized to anchor without dominating; the vaulted room leads the eye. Designer-inhabited custom residence.",
  },
  // L241 → T4 — Mountain modern lodge bedroom, late evening winter
  {
    slug: "v9_L241_T4_mountain_lodge_bedroom_depth_axis_late_evening_winter",
    prompt:
      "TREATMENT 4 — DEPTH-AXIS SHOT. 28mm lens at standing eye-level (~5.5 ft), camera positioned at the threshold of an adjacent dressing nook looking through the cased doorway down a depth axis into a mountain modern lodge bedroom beyond. The cased opening with reclaimed-oak trim frames the foreground; a timber-truss ceiling rises overhead in the bedroom; wide-plank quarter-sawn oak floor stretches into the depth. POOL ANCHOR (Line 241): Mountain modern lodge bedroom with stone-clad hearth and timber-truss ceiling + chunky wool throw and reclaimed-oak nightstand + mountain lodge — late evening winter. ACCENT PALETTE — charcoal + cognac + brass + cream cable knit: a stone-clad fireplace dominates the back wall with a low oil-rubbed bronze hearth opening showing a soft warm internal glow; a king bed centered in front of the hearth wall with layered ivory linen bedding intentionally rumpled, a chunky cream cable-knit throw folded across the foot, a charcoal wool plaid blanket draped over one side, and two layered cushions in cognac saddle-leather and cream sherpa; a reclaimed-oak nightstand at the visible side holds a stoneware vessel with a single sprig of cedar, a stack of two cognac-leather-bound novels with brass bookends, a brass-banded alarm clock, and a half-burned cream beeswax taper in a brass holder; a charcoal wool floor cushion beside the bed; a hand-knotted heritage Persian rug in charcoal-and-cream grounds the seating; a brass-and-cognac leather slipper chair tucked at the foot with a folded cream cable-knit throw. A pair of tall windows beside the fireplace show dark late-evening winter exterior with the suggestion of silhouetted pine trees against a quiet blue-gray sky and distant cabin lights faintly visible — exterior soft, the fixture is the dominant light source in the room. Warm-dimmed brass-housed recessed cans glow at the ceiling-truss junctions. The ceiling fixture is mounted overhead, identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to a beam panel, one E27 bulb visible. Occupies roughly 8% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding timber. Designer-inhabited custom residence.",
  },
  // L261 → T2 — Modern farmhouse hallway, autumn morning [POTTERY-BARN]
  {
    slug: "v9_L261_T2_modern_farmhouse_hallway_3qtr_left_autumn_morning",
    prompt:
      "TREATMENT 2 — STRONG 3/4 LEFT ANGLE. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the LEFT of center showing two walls of a modern farmhouse hallway at a 35° angle, framed medium. POOL ANCHOR (Line 261): [POTTERY-BARN] Modern farmhouse hallway with painted board-and-batten and wide-plank floor + slipcovered bench and woven-rope basket + modern farmhouse — autumn morning. Painted board-and-batten wainscoting in warm white runs the lower two-thirds of the walls; soft cream plaster above; wide-plank white-oak floor stretches into the depth. ACCENT PALETTE — black + walnut + jute + brass: a slipcovered cream linen bench across the foreground on the left wall with two scattered cushions in black-and-cream ticking stripe and rust velvet, a folded black-and-cream cable-knit throw draped over one arm; a woven-rope basket beside the bench holds rolled cream wool throws and a single small heirloom white pumpkin tucked at the top; a vintage walnut console along the right wall holds a stoneware vessel with a single substantial branch of warm-orange autumn maple, a stack of two cream-bound design books with brass bookends, a small brass-and-leather lined dish with two house keys, and a folded cream linen tea towel; a leaning gallery wall of three black-framed botanical prints above the bench; a brass-rim leaning antique mirror leans against the console wall above; a hand-knotted jute-and-cream runner along the wide-plank floor with fine fiber texture and subtle wear. A small window in the wall ahead shows soft autumn morning daylight: visible warm-amber autumn foliage and pale-blue sky beyond with light atmospheric haze, exterior soft but trees recognizable, gentle bright rolloff. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to a coffered ceiling, one E27 bulb visible. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  // L313 → T6 — French country entry, afternoon spring
  {
    slug: "v9_L313_T6_french_country_entry_tight_vignette_afternoon_spring",
    prompt:
      "TREATMENT 6 — TIGHT VIGNETTE / DETAIL ANGLE. 50mm lens at slightly elevated eye-level (~6 ft), camera tilted slightly down toward a styled French country entry vignette, framed tight. Compressed perspective; the styled console + faience platter + above-mirror is the subject. POOL ANCHOR (Line 313): French country entry with limewashed beams and limestone floor + zinc-topped console and antique faience platter + French country — afternoon spring. Exposed lime-washed wooden beams visible across the upper portion of the frame; rough whitewashed plaster wall behind the console; pale-gold limestone tile floor with grouted joints visible at the lower edge. ACCENT PALETTE — soft pink + cream + brass + sage: the zinc-topped vintage walnut console takes center foreground holding a large antique blue-and-cream French faience platter leaning at the back, an oversized cream ceramic urn of cut pale-pink garden roses with sprigs of sage botanical foliage, a small antique-brass dish of three antique skeleton keys, a folded soft-pink linen runner, a stack of two cream linen napkins embroidered with delicate pink monograms, a brass-handled hand mirror laid face-down, and a half-burned cream beeswax taper in an antique-brass candleholder; a brass-framed antique gilt mirror leans against the wall above the console; a pair of well-worn cream-canvas espadrilles tucked underneath; a folded soft-pink linen apron draped over the corner of the console; a small framed antique botanical of a pink garden rose leans on the console; warm-dimmed brass-housed recessed cans glow softly. A small high window glimpsed in the upper-right corner shows soft afternoon spring daylight: visible green hedge and pale-blue sky beyond with gentle haze, exterior soft, subtle bright rolloff. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the beamed ceiling, one E27 bulb visible. Occupies roughly 14% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding beams. Designer-inhabited custom residence.",
  },
  // L410 → T5 — Reading nook with built-in bench and bay window, afternoon autumn
  {
    slug: "v9_L410_T5_reading_nook_bay_window_low_angle_up_afternoon_autumn",
    prompt:
      "TREATMENT 5 — LOW ANGLE LOOKING UP. 35mm lens at LOW height (~3.5 ft off the floor), camera tilted up 15° toward the fixture and the coffered ceiling above a reading nook. POOL ANCHOR (Line 410): Reading nook with built-in bench and bay window + skirted chair and stack of books + traditional — afternoon autumn. A traditional coffered ceiling in warm cream rises overhead; tall paneled walls in soft warm white meet deep crown molding; the lower portion of the frame catches the top of a deep-set bay window built-in bench and the back of a skirted reading chair. ACCENT PALETTE — cinnamon velvet + cream linen + rust + dusty pink: the cream-painted built-in bench under the three-panel bay is upholstered in cream linen with a tufted seat cushion, layered cushions in cinnamon velvet and dusty-pink ticking stripe, and a folded rust quilted-velvet throw casually draped over one arm; a stack of three autumn-reading hardcovers with cream and rust covers and one small dusty-pink novella sits on the bench with a pair of round wire-rim reading glasses laid on the open top book; a small brass-rim glass pitcher of dried wheat-and-cinnamon-marigold arrangement on the windowsill; a vintage cream-painted skirted reading chair faces the window with a folded rust-and-cream cable-knit throw; a hand-knotted cinnamon-and-cream Persian rug under the chair with fine pile and subtle wear; warm-dimmed brass-housed recessed cans glow in the coffered ceiling. The three-panel bay window shows soft afternoon autumn daylight: visible warm-amber autumn maple foliage and pale blue-grey sky with light atmospheric haze beyond, exterior softer than the interior but trees recognizable with gentle bright rolloff into the room. The ceiling fixture is identical to the reference — compact semi-flush square crystal cage of vertical clear faceted prisms around four brushed-brass corner posts, brass top and bottom frames, round brass canopy flush to the coffered ceiling, one E27 bulb visible. Occupies roughly 18% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. The fixture earns its prominence in the upward angle. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v9-${path.basename(REF)}`);
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
