/**
 * v16 — Walnut + fluted-glass entry semi-flush, applying NEW angles from flush-and-semi-flush.md
 * (none reused from v14) on FRESH scenes from indoor-ceiling.md (none reused from v14).
 *
 * Distribution:
 *   Fixture %: DOMINANT 22%, PROMINENT 12%, CONTEXTUAL 6%, CONTEXTUAL 8% → ≥1 DOMINANT ✓, ≥1 CONTEXTUAL ✓
 *   Heights:   STANDING 5.25, ELEVATED 6, STANDING 5, LOW 4 → 2 non-standing (ELEVATED + LOW) ✓
 *   Lenses:    WIDE 26, NORMAL-WIDE 35, NORMAL-WIDE 32, NORMAL 40 → 3 distinct classes ✓
 *   Pitch:     slight up 5°, level, slight down 7°, level → varied
 *
 * Angle × scene pairs (validated against flush-and-semi-flush.md Best-for / NOT-for):
 *   DOWN-CORRIDOR-DEPTH-AXIS    × L256 English country hall — herringbone brick, low beams
 *   CORNER-TWO-WALL-COMPOSITION × L300 Grand entry hall — curved staircase, double-height
 *   WHOLE-ROOM-STYLED-VIGNETTE  × L460 Sewing room — vaulted shiplap, linen-spool wall
 *   CROPPED-FROM-BELOW          × L425 Yoga/meditation room — tatami, ikebana
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

const REF = path.join(os.tmpdir(), "scene", "p1", "p1_1.jpg");

const GUARDRAILS = `ABSOLUTE FIDELITY: replicate the fixture exactly — small semi-flush ceiling fixture with a SOLID WALNUT WOOD canopy / housing block mounted flush to the ceiling. Suspended just below the walnut canopy on a short slender stem is a FLUTED / RIBBED WHITE OPAL GLASS DOME SHADE with vertical narrow ridges running top-to-bottom around the curved dome surface, the bottom of the dome scalloped in a soft skirt-hem petal silhouette. The fixture is COMPACT and intended for entry / hallway / small room applications. When switched on, warm light glows through the fluted opal glass.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS — visible but soft: real trees, branches, hedges, pale soft sky. Brighter than interior but NOT pure white blown-out. Soft natural rolloff. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // ANGLE: DOWN-CORRIDOR-DEPTH-AXIS × SCENE: L256 English country hall
  {
    slug: "v16_DOWN_CORRIDOR_DEPTH_AXIS_english_country_hall",
    prompt:
      "CAMERA ANGLE — DOWN-CORRIDOR-DEPTH-AXIS: This is a corridor depth-axis shot taken from a STANDING camera position 5.25 ft off the floor at one end of a long English country hall, looking straight down its length. The lens is WIDE 26mm focal length — strong depth pull and slight edge expansion. There is a row of THREE fluted-glass semi-flush fixtures mounted along the centerline of the hall ceiling, receding into depth. The FOREGROUND fixture (nearest the camera) is LARGE in the frame and reads as DOMINANT at 22 PERCENT, the middle and far fixtures are progressively smaller along the depth axis. Camera pitch tilts very slight up 5° so the ceiling line reads. Deep depth-of-field — foreground fixture and far end of hall both in focus. Reference: Dazuma signature corridor-flush merch shot. " +
      "POOL ANCHOR (Line 256): English country hall with herringbone brick and low beams + scrubbed-pine console and stoneware urn + English country — late afternoon spring. The architecture: a long low-ceilinged hall with hand-laid herringbone red-brick floor visible across the lower frame stretching into depth; rough lime-washed walls in pale cream with hand-troweled texture; low dark-stained oak beams cross the ceiling between the fixtures; cased openings to side rooms break the wall on both sides midway down. ACCENT PALETTE — soft cream + scrubbed pine + stoneware grey + soft moss: a scrubbed-pine console table against the left wall in the middle distance holds a large hand-thrown stoneware urn with a tall arrangement of cut spring branches and pale wildflowers, a stack of two cream-bound English-garden monographs spine-out, a worn leather-bound visitor's book with a brass pen, and an antique-brass candle stick with a half-burned ivory taper; an antique English oak bench against the right wall further down with a folded soft-moss wool throw and a vintage tortoise riding-boot stand beside; a vintage hand-loomed cream-and-soft-moss runner rug stretches the length of the herringbone brick floor; a tall sash window at the far end of the hall shows soft late-afternoon spring light: visible green-budding trees and pale-grey sky with light atmospheric haze. The three fixtures along the ceiling are identical to the reference — walnut canopy semi-flush mounts with fluted opal-glass dome shades, all switched ON emitting warm 2700-3000K glow that pools warmly on the lime-washed walls and herringbone brick. Designer-inhabited custom residence.",
  },
  // ANGLE: CORNER-TWO-WALL-COMPOSITION × SCENE: L300 Grand entry hall
  {
    slug: "v16_CORNER_TWO_WALL_COMPOSITION_grand_entry_curved_stair",
    prompt:
      "CAMERA ANGLE — CORNER-TWO-WALL-COMPOSITION: This is a corner two-wall shot taken from an ELEVATED camera position 6 ft off the floor (slight elevation, near the bottom landing of the staircase). The lens is NORMAL-WIDE 35mm focal length — natural perspective showing both walls. The camera shows TWO adjacent architectural walls at a 30-45° oblique angle: the curved staircase wall on one side and the entry-hall wall on the other, meeting at a corner near center frame. A semi-flush fixture is mounted to the entry-hall ceiling above the console wall and occupies 12 PERCENT of the frame — PROMINENT scale. Camera pitch is level. Deep depth-of-field. Reference: Pottery Barn layered framing; Dazuma corner composition. " +
      "POOL ANCHOR (Line 300): [POTTERY-BARN] Grand entry hall with double-height ceiling and curved staircase + console with hurricanes and tall topiary + traditional — late afternoon autumn. The architecture: a double-height entry with crown moulding and millwork wainscoting in soft cream; a gracefully CURVED staircase rises along the left wall with deep-mahogany handrail on slim painted balusters and a worn antique runner in faded ochre-and-cream; the entry-hall wall on the right holds a console between two doorways. ACCENT PALETTE — antique brass + cream + faded ochre + dark walnut: against the right wall, a polished antique walnut console table holds two tall hand-blown clear-glass hurricanes with half-burned ivory tapers flickering, a small antique-brass tray with a folded soft-ochre linen tea towel and a single brass-rim crystal bowl of bittersweet branches, and a stack of two cream-bound design monographs spine-out; a tall topiary in an aged terracotta pot flanks each side of the console; a hand-knotted faded-ochre-and-cream Persian rug centers the wide-plank dark-stained oak floor; a gilt-framed leaning antique architectural watercolor against the wall beside the staircase. A tall arched window at the staircase landing high above shows soft late-afternoon autumn light: visible warm-ochre and copper leafed branches and a pale-grey sky with thin warm horizon band. The fixture is identical to the reference — walnut canopy semi-flush mount with fluted opal-glass dome, mounted to the entry-hall ceiling above the console, switched ON with warm 2700-3000K glow that catches in the polished walnut of the console below. Designer-inhabited custom residence.",
  },
  // ANGLE: WHOLE-ROOM-STYLED-VIGNETTE × SCENE: L460 Sewing room
  {
    slug: "v16_WHOLE_ROOM_STYLED_VIGNETTE_sewing_room_shiplap",
    prompt:
      "CAMERA ANGLE — WHOLE-ROOM-STYLED-VIGNETTE: This is a whole-room styled vignette taken from a STANDING camera position 5 ft off the floor. The lens is NORMAL-WIDE 32mm focal length — full room reads with multiple design elements co-existing. Camera position is off-axis 30° to one side; the fixture is one element among many in the frame and occupies just 6 PERCENT of the frame — CONTEXTUAL scale. Camera pitch tilts slight DOWN 7° to register the floor and grounded objects below. Deep depth-of-field. The fixture sits in the upper-third reading as ambient warmth, not focal subject. Reference: Schoolhouse Electric whole-room editorial. " +
      "POOL ANCHOR (Line 460): Sewing room with vaulted shiplap ceiling and pine plank floor + farm table and linen-spool wall + modern farmhouse — afternoon spring. The architecture: a vaulted ceiling with painted-white horizontal shiplap rising to a soft peak overhead, white-painted exposed rafters; lime-washed walls in pale cream; wide-plank reclaimed pine floor stretching across the room. ACCENT PALETTE — bleached pine + cream + faded ochre + soft moss: in the middle of the room a long farmhouse-style work table in scrubbed pine with an open sewing project in cream linen, a half-stitched soft-moss linen panel, a pair of antique steel sewing shears in tortoiseshell handle, a wooden bobbin holder with a half-dozen waxed-linen-thread spools in ivory and soft-ochre, a folded faded-ochre wool blanket draped over one end, and a stack of two cream-bound textile-design monographs spine-out with brass bookends; a vintage spindle-back wooden chair tucked at the table; against one wall a custom wall-mounted thread spool rack with neatly arranged vintage wooden spools in cream-ivory and soft-ochre-and-moss thread; an antique pine-and-iron sewing-machine cabinet against the far wall with a vintage cast-iron sewing machine; a tall wicker basket on the floor full of folded cream linen yardage; a hand-loomed faded-ochre-and-cream rag rug grounds the floor. A tall casement window on the side wall shows soft afternoon spring light: visible green-budding branches and pale-blue sky. The fixture is identical to the reference — walnut canopy semi-flush mount with fluted opal-glass dome — visible in the upper-third of the frame mounted to the shiplap peak as ambient context, switched ON with soft warm 2700-3000K glow. Designer-inhabited custom residence.",
  },
  // ANGLE: CROPPED-FROM-BELOW × SCENE: L425 Yoga / meditation room
  {
    slug: "v16_CROPPED_FROM_BELOW_yoga_meditation_japandi",
    prompt:
      "CAMERA ANGLE — CROPPED-FROM-BELOW: This is a cropped-edge shot taken from a LOW camera position 4 ft off the floor. The lens is NORMAL 40mm focal length — undistorted. The fixture is CROPPED at the top edge of the frame: only the LOWER PORTION of the fluted opal-glass dome is visible at the very top edge, the walnut canopy entirely cropped out. The visible cropped portion occupies 8 PERCENT of the frame — CONTEXTUAL scale, signaling the fixture exists while selling the room beneath. Camera pitch is level. Deep depth-of-field. The room composition dominates the frame; the fixture's warm glow spills DOWN from the cropped edge into the upper room. Reference: Schoolhouse Electric / Pottery Barn cropped-edge editorial. " +
      "POOL ANCHOR (Line 425): Yoga / meditation room with white-oak slat ceiling and tatami floor + low platform and ikebana branch + Japandi — overcast morning. The architecture: just visible at the top of the frame above the cropped fixture, a horizontal white-oak slat ceiling with thin gaps between slats and honed-plaster walls in soft warm cream; the floor is laid in fresh tatami mats with crisp soft-cream binding edges. ACCENT PALETTE — soft charcoal + cream + walnut + sage: a low minimal walnut meditation platform centered in the room with a single folded soft-charcoal wool meditation cushion squared on top and a folded cream linen blanket precisely folded at the edge; a tall slim pale-charcoal stoneware ikebana vessel beside the platform holding a single cherry branch with sparse white buds; a low walnut altar shelf against the far wall with three pale-charcoal stoneware vessels in graduated size, a single small antique-brass incense holder with a faint trail of smoke, and a folded soft-sage linen runner; a hand-loomed cream-and-soft-sage tatami runner; a sliding shoji-style screen at one side filtering soft overcast morning light: behind the shoji are visible Japanese maple branches and pale-grey sky. The fixture is identical to the reference — walnut canopy semi-flush mount with fluted opal-glass dome — but ONLY the lower portion of the fluted opal-glass dome is visible at the very top of the frame; the walnut canopy is cropped off above the frame. Switched ON, warm 2700-3000K glow spills DOWN from the cropped fixture casting soft warm light across the tatami platform and the cherry branch. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v16-${path.basename(REF)}`);
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
