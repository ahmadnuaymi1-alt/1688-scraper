/**
 * v14 — Memphis flush mount with EXPLICIT camera angle library directives.
 *
 * Distribution constraints validated:
 *   Fixture-%: DOMINANT (15%), PROMINENT (12%), CONTEXTUAL (6%), PROMINENT (10%) → ≥1 DOMINANT ✓, ≥1 CONTEXTUAL ✓
 *   Heights:   LOW 3 ft, LOW 3.25 ft, STANDING 5.25 ft, STANDING 5 ft → ≥2 non-standing ✓
 *   Lenses:    WIDE-NORMAL, WIDE, NORMAL, NORMAL-WIDE → 4 distinct classes ✓
 *   Pitch:     UP 30°, UP 10°, level, level → 2 up + 2 level ✓
 *
 * Angle × scene pairings (compatibility validated against flush-and-semi-flush.md Best-for / NOT-for):
 *   LOW-DOMESTIC-LOOK-UP        × L23  Belgian sitting room          (domestic look-up, low ceiling, sitting room)
 *   CATHEDRAL-UP-BEAM-EMPHASIS  × L345 Italianate piano nobile entry (frescoed ceiling = strong architecture)
 *   THROUGH-THRESHOLD-VIGNETTE  × L210 French country bedroom        (bedroom viewed from adjacent space)
 *   OFF-CENTER-THIRDS-RIGHT     × L99  Scandi summer cottage         (sitting room, off-center upper-right)
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
  // ANGLE: LOW-DOMESTIC-LOOK-UP × SCENE: L23 Belgian sitting room
  {
    slug: "v14_LOW_DOMESTIC_LOOK_UP_belgian_sitting_room",
    prompt:
      "CAMERA ANGLE — LOW-DOMESTIC-LOOK-UP: This is a domestic look-up shot taken from a LOW camera position 3 ft off the floor (kitchen-counter / child eye-level). The lens is WIDE-NORMAL 30mm focal length — slight room expansion without distortion. The fixture is positioned in the UPPER-LEFT THIRD of the frame and occupies 15 PERCENT of the frame area — DOMINANT scale, the fixture reads as architectural punctuation, not as a small decorative element. Camera pitch tilts UP 30 DEGREES so the ceiling fills the upper half of the frame. Deep depth-of-field: full room from foreground rug to ceiling fixture is in sharp focus. The viewer's eye is drawn first to the fixture, then down to the room beneath. Reference: Schoolhouse Electric domestic-editorial signature — fixture as the room's HERO, not a small accent. " +
      "POOL ANCHOR (Line 23): Belgian-modern sitting room with limewashed plaster walls and bleached oak beams + sand-toned linen seating + Belgian — blue hour winter. Rough limewashed plaster ceiling and walls with hand-troweled texture visible filling the upper half of the frame; exposed bleached-oak beams cross the ceiling with one beam grazing past the fixture. ACCENT PALETTE — sand + cream + brass + soft sage: in the lower frame seen from low angle a deep oversized sand-linen sofa anchors the foreground with two layered cushions in cream bouclé and faded soft-sage linen and a folded cream wool throw draped over one arm; a low round bleached-oak coffee table holds a half-burned cream beeswax taper in an antique-brass holder, a small soft-sage stoneware vessel with three sprigs of olive, a stack of two cream-bound design monographs spine-out; a hand-knotted heritage sand-and-cream wool rug grounds the seating in the immediate foreground at the bottom of the frame. A tall window beyond the sofa shows soft fading blue-hour winter light: silhouetted bare branches against a quiet violet-grey evening sky with subtle warm horizon band. The fixture is identical to the reference — Memphis-style compact semi-flush, cream canopy mounted flush against a panel of limewashed plaster between two bleached-oak beams in the UPPER-LEFT THIRD, flat amber-glass donut shade, frosted white diffuser underneath emitting warm light, small RED CERAMIC BALL accent visible. Switched ON, soft warm 2700-3000K glow throws warm light across the limewashed plaster ceiling. Designer-inhabited custom residence.",
  },
  // ANGLE: CATHEDRAL-UP-BEAM-EMPHASIS × SCENE: L345 Italianate piano nobile entry
  {
    slug: "v14_CATHEDRAL_UP_BEAM_EMPHASIS_italianate_piano_nobile",
    prompt:
      "CAMERA ANGLE — CATHEDRAL-UP-BEAM-EMPHASIS: This is a beam-emphasis architectural shot taken from a LOW camera position 3.25 ft off the floor. The lens is WIDE 26mm focal length — captures the full ceiling architecture above. The fixture is positioned at the upper-center of the frame and occupies 12 PERCENT of the frame area — PROMINENT scale. Camera pitch tilts UP 10 DEGREES so the architectural ceiling (the frescoed Italianate ceiling) dominates the upper half of the frame. Deep depth-of-field. The viewer's eye reads the frescoed ceiling as the architectural envelope, with the fixture as a focal accent suspended within it. Reference: Pottery Barn beam-emphasis tilt; AD-style cathedral-ceiling editorial. " +
      "POOL ANCHOR (Line 345): Italianate piano nobile entry with frescoed ceiling and arched French doors + silk-embroidered settee and gilt console + Italianate — golden hour late summer. The upper half of the frame is dominated by a hand-painted frescoed ceiling — pale azure ground with soft trompe-l'oeil clouds and gilded plasterwork bordering an oval center medallion; faded ochre and umber pigments around the perimeter; the fixture is mounted just below the center medallion of the fresco. The lower half shows the entry: aged Carrara-marble floor in soft cream and grey; tall arched French doors at the back wall with delicate iron grillework; pale sand-rendered walls. ACCENT PALETTE — gilt + cream + faded silk + soft umber: a slim gilt console table against the back wall between the French doors holds a tall pale-cream porcelain urn with three sprigs of olive, a stack of two cream-bound architectural monographs spine-out, an antique-brass candelabrum with three half-burned ivory tapers, and a small gilt-rimmed crystal bowl with citrus; a silk-embroidered cream-and-soft-umber settee in the foreground at one side with two layered cushions in cream silk and faded ochre; a worn antique Aubusson cream-and-umber wool rug centers the floor; a tall gilt-framed antique architectural drawing leans against the side wall. Through the arched French doors at the back, soft golden-hour late-summer light spills in with visible green cypress and a pale-warm sky. The fixture is identical to the reference — Memphis-style compact semi-flush, cream canopy mounted flush against the painted plaster just below the fresco oval medallion in the upper center, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow on the fresco. Designer-inhabited custom residence.",
  },
  // ANGLE: THROUGH-THRESHOLD-VIGNETTE × SCENE: L210 French country bedroom
  {
    slug: "v14_THROUGH_THRESHOLD_VIGNETTE_french_country_bedroom",
    prompt:
      "CAMERA ANGLE — THROUGH-THRESHOLD-VIGNETTE: This is a through-threshold shot taken from a STANDING camera position 5.25 ft off the floor in the ADJACENT hallway looking through a cased doorway into the bedroom. The lens is NORMAL 32mm focal length — undistorted natural eye perspective. The fixture is positioned in the middle ground of the bedroom beyond the doorway and is partially cropped on one side by the doorway frame, occupying just 6 PERCENT of the frame area — CONTEXTUAL scale. Camera pitch is level. Deep depth-of-field. The doorway casing dominates the outer edges of the frame; the fixture is one of many elements inside the next room. Reference: Schoolhouse Electric threshold-vignette signature; Pottery Barn through-doorway editorial. " +
      "POOL ANCHOR (Line 210): French country bedroom with limewashed beams and limestone floor + scrolled iron bed and linen drapes + French country — golden hour autumn. The foreground edges show a cream-painted millwork doorway casing with subtle shadow lines on both sides; the hallway floor at the bottom of the frame is wide-plank reclaimed oak with a soft jute runner. Through the doorway: rough limewashed bedroom walls with hand-troweled texture; limewashed exposed beams cross a pale honey-cream limestone floor; a scrolled antique-iron bed with a soft cream linen duvet, two layered pillows in faded oat-and-cream stripe and pale-blush linen, and a folded soft-ochre cashmere throw at the foot. ACCENT PALETTE — pale ochre + cream + brass + faded blush: a slim limewashed-oak side table beside the bed with a small ironstone pitcher of dried wheat sprigs, a brass-and-tortoise reading lamp (switched off, decorative), a half-burned cream beeswax taper in an antique-brass holder, a stack of two cream-bound French-country monographs; a narrow limewashed armoire against the back wall; a pale linen drape pooling at the floor by a window inside the bedroom that shows soft golden-hour autumn light with visible bare ochre-leafed branches and a warm-amber sky. The fixture is identical to the reference — Memphis-style compact semi-flush, cream canopy mounted flush to the bedroom ceiling beyond the doorway, partially cropped by the doorway frame on the left side, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow on the bedroom limewashed walls. Designer-inhabited custom residence.",
  },
  // ANGLE: OFF-CENTER-THIRDS-RIGHT × SCENE: L99 Scandi summer cottage living room
  {
    slug: "v14_OFF_CENTER_THIRDS_RIGHT_scandi_summer_cottage",
    prompt:
      "CAMERA ANGLE — OFF-CENTER-THIRDS-RIGHT: This is an off-center rule-of-thirds shot taken from a STANDING camera position 5 ft off the floor. The lens is NORMAL-WIDE 35mm focal length — natural room expansion without distortion. The fixture is positioned in the UPPER-RIGHT THIRD of the frame and occupies 10 PERCENT of the frame area — PROMINENT scale. Camera pitch is level. Deep depth-of-field. The left two-thirds of the frame are occupied by the room's main furniture and styled vignette; the fixture anchors the upper-right corner. Reference: Pottery Barn / Schoolhouse off-center editorial. " +
      "POOL ANCHOR (Line 99): Scandinavian summer cottage living room with painted beadboard ceiling and pine plank floor + slipcovered linen sofa and birch branch arrangement + Scandinavian — late afternoon summer. Painted white beadboard ceiling with thin painted exposed beams; whitewashed pine plank floor stretches across the room. ACCENT PALETTE — bleached birch + cream + soft blue + brass: in the LEFT TWO-THIRDS of the frame, an oversized slipcovered ivory linen sofa anchors the foreground with two layered cushions in cream waffle-cotton and soft-blue ticking stripe and a folded cream cable-knit throw; a low round bleached-birch coffee table holds a tall white stoneware pitcher of birch branches, a stack of two cream-bound Nordic-design monographs spine-out, a brass-rim glass tumbler, and a small antique-brass tray; a slipcovered cream linen accent chair to one side with a folded soft-blue waffle-cotton blanket; a hand-woven cream-and-soft-blue jute-and-cotton rug; a brass-framed leaning Nordic landscape watercolor against the side wall above a slim birch credenza. A tall casement window on the back wall shows soft late-afternoon summer light: visible green birch trees and pale-blue sky with light atmospheric haze. The fixture is positioned in the UPPER-RIGHT THIRD of the frame, identical to the reference — Memphis-style compact semi-flush, cream canopy flush to the beadboard ceiling on the right side, flat amber-glass donut shade, frosted white diffuser, small RED CERAMIC BALL accent. Switched ON, soft warm 2700-3000K glow on the beadboard. Designer-inhabited custom residence.",
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
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v14-${path.basename(REF)}`);
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
