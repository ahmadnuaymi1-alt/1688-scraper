/**
 * v7 — single product test of the v7 skill rules:
 *   - EXPLICIT per-slot camera treatment assignment (each of T1-T6 appears exactly once)
 *   - Soft interior-window-sky treatment (diffused, silhouetted, no dramatic skies)
 *   - All prior rules preserved (anti-convergence, palette echo, lived-in styling, no alcohol)
 *
 * Product C — cream "bean" disc flush-mount (cream aluminum, frosted dome, red ceramic dot accent)
 * Treatment assignment: S1=T4, S2=T2, S3=T6, S4=T1, S5=T5, S6=T3
 * Rooms (max 2 obvious): connector hallway (obvious) + primary bedroom + powder room + top-of-stairs + children's bedroom + home office
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

const REF = path.join(os.tmpdir(), "scene", "p3", "p3_2.jpg"); // cream bean disc, ceiling mounted shot

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — a slim disc-shaped flush mount with cream-painted aluminum body, super-thin profile, frosted white acrylic dome diffuser, and a SMALL RED CERAMIC BALL ACCENT at one edge of the rim. Do not change the silhouette, finish, or omit the red dot.

ONE SINGLE 1:1 photograph. No collage, grid, mood board. ZERO Mandarin / Chinese / Asian characters. No app chrome. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS: if a window is visible, the exterior must be SOFT, DIFFUSE, UNDEREMPHASIZED — sheer curtains filtering daylight, slight overexposure, glimpse of out-of-focus greenery, or silhouetted branches. Do NOT render dramatic clouds, vivid skies, sunset gradients, or detailed moon-and-stars through interior windows.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  {
    slug: "v7_C1_T4_connector_hallway_depth_axis_navy",
    prompt:
      "TREATMENT 4 — DEPTH-AXIS SHOT looking through a connector hallway. 28mm lens at standing eye-level (~5.5 ft), camera positioned at the threshold of one room looking straight down a connector hallway toward a cased doorway at the far end. Tray ceiling above with thin painted reveal trim; tall paneled walls in soft warm white meet deep baseboards; herringbone white-oak floor stretches into the depth of the corridor. ACCENT PALETTE — navy + brass + cream + dried branch: a hand-knotted navy-and-cream Persian runner runs the length of the corridor showing fine pile and subtle wear; a vintage walnut console along the right wall holds a tall navy stoneware vase with a single dried wisteria branch, a brass-and-leather lined dish with two house keys, a stack of two cream-bound design books with brass bookends, and a small brass alarm clock; a leaning gallery wall along the left wall of four mixed black-framed pieces — two architectural photographs in slim brass frames, a small navy oil sketch, and a leaning antique gilt mirror; warm-dimmed brass-housed recessed cans glow in the tray ceiling. The far doorway frames a glimpse of an arched window beyond showing soft fading evening light, silhouetted branches against a quiet blue-gray sky — exterior diffused, no specific cloud detail. The ceiling fixture is mounted overhead midway down the corridor, identical to the reference — slim disc-shaped flush mount, cream-painted aluminum body, super-thin profile, frosted white acrylic dome diffuser, small RED CERAMIC BALL ACCENT at one edge of the rim. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding tray ceiling. Sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v7_C2_T2_primary_bedroom_3qtr_left_slate_blue",
    prompt:
      "TREATMENT 2 — STRONG 3/4 LEFT ANGLE. 35mm lens at standing eye-level, camera positioned to the LEFT of center showing two walls of a primary bedroom at a 35° angle, framed medium. A tray ceiling rises overhead with thin painted reveal trim; the back wall is a fully panel-molded wainscoting wall in soft warm white; the bed sits centered against the back wall with a cream linen tufted bouclé headboard. ACCENT PALETTE — slate blue chambray + cream tufted bouclé + brass + soft sage: layered bedding in chambray slate-blue, cream, and ivory linen intentionally rumpled (not made, not messy); a small honed-marble tray on the duvet holding an open hardcover novel with round wire-rim reading glasses laid on the page and a slim brass-and-leather bookmark; a vintage walnut nightstand at the left of the bed holds a cream ceramic vessel with three sage botanical stems, a stack of two cream-bound art books with brass bookends, a slim brass alarm clock, and a small dish of brass-tipped pencils; a long slate-blue chambray bench at the foot of the bed with a folded soft-sage wool throw and one cream waffle-weave robe draped over its arm; a hand-knotted slate-blue-and-cream Persian rug on the herringbone white-oak floor with fine pile and visible wear; a brass-trimmed leaning antique mirror against the side wall above a small walnut credenza. Sheer linen curtains at a tall window on the right wall filter bright morning daylight — the exterior reads as a glimpse of soft out-of-focus greenery, no specific cloud or sky detail. The ceiling fixture is identical to the reference — slim disc-shaped flush mount, cream-painted aluminum body, super-thin profile, frosted white acrylic dome, small RED CERAMIC BALL accent at one edge of the rim. Occupies roughly 10% of the frame. Switched ON, soft warm 2700-3000K accent within the morning interior. Sized to anchor without dominating. Designer-inhabited custom residence.",
  },
  {
    slug: "v7_C3_T6_powder_room_tight_vignette_terracotta",
    prompt:
      "TREATMENT 6 — TIGHT VIGNETTE / DETAIL ANGLE. 50mm lens at slightly elevated eye-level (~6 ft), camera tilted slightly down toward a styled powder room corner showing the fixture overhead, the upper portion of the arched mirror, and the top of the marble vanity counter. Compressed perspective; less of the room, more of the styled corner. Honed-Calacatta-marble counter with subtle veining floats on a slim brushed-brass bracket below an antique-brass arched mirror; the back wall in deep terracotta grasscloth wallpaper with subtle metallic-thread veining. ACCENT PALETTE — terracotta + cream + brass + olive: a single chiseled-bronze vessel sink with an antique-brass single-handle faucet rising behind; a stack of two cream linen hand towels with embroidered terracotta monograms on a small antique-brass tray, a terracotta-glaze ribbed apothecary bottle, a small olive-bound poetry book left face-down on a corner of the counter, a brass-handled hairbrush, a hand-painted ceramic dish holding a single rose-quartz crystal, a tiny olive sprig in a brass-rim glass bud vase; an antique-brass picture-light glows softly above a small framed sepia botanical sketch leaning on the marble shelf. No window visible in this tight crop. The ceiling fixture is identical to the reference — slim disc-shaped flush mount, cream-painted aluminum body, super-thin profile, frosted white acrylic dome, small RED CERAMIC BALL accent at the edge of the rim. Occupies roughly 16% of the frame. Switched ON, soft warm 2700-3000K glow on the cream-lacquer ceiling. The fixture's prominence is appropriate to the tight crop; it anchors the styled corner. Designer-inhabited custom residence.",
  },
  {
    slug: "v7_C4_T1_top_of_stairs_gallery_wide_burgundy",
    prompt:
      "TREATMENT 1 — WIDE ESTABLISHING SHOT. 28mm lens at standing eye-level (~5.5 ft), straight-on framing pulled back to show a top-of-stairs gallery overlooking a foyer below. The room is the hero; fixture small in the upper center of the frame. A coffered ceiling overhead; paneled walls in warm cream; wide-plank quarter-sawn white-oak floor stretches across the gallery; a matte-black steel-and-glass railing crosses the lower foreground over the open stairwell. ACCENT PALETTE — burgundy + walnut + cream + brass: a vintage walnut mid-century reading chair tucked in the back corner with a folded burgundy wool throw across its seat; a low walnut side table beside the chair holds a stack of two cream-bound design books, a small burgundy ceramic vessel with a single dried thistle, a brass alarm clock, and an open hardcover landscape book left face-down; a large piece of muted-abstract burgundy-and-cream art leans against the back wall on the floor rather than hanging; a brass-trimmed antique gilt mirror leans against the side wall above a small burgundy-cushioned ottoman; a hand-knotted burgundy-and-cream Persian runner along the gallery showing visible pile and fine wear. A tall arched window above the stairwell is slightly overexposed with diffused natural daylight pouring in, exterior reading as soft pale daylight with no specific cloud detail. The ceiling fixture is identical to the reference — slim disc-shaped flush mount, cream-painted aluminum body, super-thin profile, frosted white acrylic dome, small RED CERAMIC BALL accent at one edge of the rim. Occupies roughly 6% of the frame. Switched ON, soft warm 2700-3000K accent within the bright daylight. Sized to anchor without dominating; the gallery and stairwell lead the eye. Designer-inhabited custom residence.",
  },
  {
    slug: "v7_C5_T5_childrens_bedroom_low_angle_up_dusty_pink",
    prompt:
      "TREATMENT 5 — LOW ANGLE LOOKING UP. 35mm lens at LOW height (~3.5 ft off the floor), camera tilted up 15° toward the flush-mount fixture and the ceiling. A custom children's bedroom; a soft warm cream coffered ceiling overhead with thin painted reveal trim; tall paneled walls in cream with a subtle pale-pink-blush wash; a small portion of the room visible in the lower portion of the frame. ACCENT PALETTE — dusty pink + cream + brass + sage: the foreground catches the top edge of a vintage cream-painted spindle daybed with layered linen bedding in cream, dusty pink, and sage intentionally rumpled with a folded sage waffle blanket and one knit cream comfort doll nestled against the pillows; a vintage walnut nightstand at the bedside holds a small dusty-pink ceramic vessel with three sage botanical stems, a brass-handled wind-up music box, a stack of two cream-bound children's storybooks, and a small brass-rim glass bud vase with a single peony; the dome of the ceiling fixture fills the upper portion of the frame, the small RED CERAMIC BALL accent clearly visible at the rim; a hand-knotted dusty-pink-and-cream Persian rug visible at the lower edge with fine pile; a brass-framed leaning watercolor of a small cottage against the side wall. A tall window on the right wall has sheer cream linen curtains filtering bright midday daylight — exterior reads as out-of-focus green foliage beyond, no specific cloud detail. The ceiling fixture is identical to the reference — slim disc-shaped flush mount, cream-painted aluminum body, super-thin profile, frosted white acrylic dome, small RED CERAMIC BALL accent at one edge of the rim. Occupies roughly 22% of the frame. Switched ON, soft warm 2700-3000K glow on the surrounding coffered ceiling. The fixture earns its prominence in the upward angle. Designer-inhabited custom residence.",
  },
  {
    slug: "v7_C6_T3_home_office_library_wall_3qtr_right_forest_green",
    prompt:
      "TREATMENT 3 — STRONG 3/4 RIGHT ANGLE. 35mm lens at standing eye-level (~5.5 ft), camera positioned to the RIGHT of center showing two walls of a custom home office at a 35° angle, framed medium. The back wall is floor-to-ceiling built-in walnut bookshelves dense with leather-bound books in tobacco, ochre, and forest green with brass spine bands; a rolling brass-and-walnut library ladder rests against the shelves; the side wall on the left features paneled wainscoting in soft warm white. ACCENT PALETTE — forest green + cognac + brass + cream: a vintage cognac-leather Chesterfield writing chair faces a walnut desk holding a brass-banded reading lamp (switched off, decorative), an open leather-bound notebook with a brass-and-tortoise pen laid on the page, a folded forest-green wool throw over the chair arm, a small ceramic mug on a cork coaster, and a forest-green ceramic vessel with a single dried thistle; a brass-and-cognac leather desk blotter holds a stack of three cream-bound design monographs; a hand-knotted forest-green-and-cream Persian rug on the herringbone walnut floor with visible pile; a brass-framed leaning pencil sketch against the bookshelf base; one cognac-cushioned ottoman doubling as a footrest; a brass globe on a walnut stand beside the desk. Warm-dimmed brass cove lighting glows behind a top crown moulding. A tall window behind the desk is slightly overexposed with diffused natural daylight pouring in, exterior reading as soft out-of-focus green foliage beyond — no specific cloud or sky detail. The ceiling fixture is mounted overhead, identical to the reference — slim disc-shaped flush mount, cream-painted aluminum body, super-thin profile, frosted white acrylic dome, small RED CERAMIC BALL accent at one edge of the rim. Occupies roughly 9% of the frame. Switched ON, soft warm 2700-3000K glow. Sized to anchor without dominating; the bookshelves and desk lead the eye. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v7-${path.basename(REF)}`);
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
