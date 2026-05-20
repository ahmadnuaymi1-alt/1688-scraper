/**
 * v23 — Same product as v16 (walnut + swirled-wave opal-glass semi-flush, 1688 offer 930159619675).
 * Pipeline structure matches v16 EXACTLY except the GUARDRAILS block is rewritten to separate
 * "what the product IS" from "how the product is viewed" — so the model is permitted to render
 * the product from each scene's camera angle instead of copy-pasting the reference image's view.
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

// NEW guardrails — separates product IDENTITY from product VIEW.
const GUARDRAILS = `PRODUCT IDENTITY (must match reference image):
The product is a small ceiling-mounted semi-flush light. A round SOLID WALNUT WOOD CANOPY disc is mounted flush against the ceiling. Suspended just below the walnut canopy on a short slender stem is an OPAL-WHITE GLASS DOME SHADE with a soft swirled wave pattern around its curved surface — broad continuous waves that wind around the dome as they descend. The bottom edge of the dome is scalloped into a soft petal skirt-hem with 6 to 7 rounded petal lobes around the rim. Materials: matte walnut wood canopy + matte opal-white shade. When switched on, warm 2700-3000K light glows softly through the opal material.

The product's MATERIALS, COLORS, SILHOUETTE, PROPORTIONS, and DISTINCTIVE FEATURES (walnut canopy, opal-white dome with swirled wave surface, scalloped petal skirt-hem) must match the reference image exactly. However, the product's VIEWING ANGLE, ORIENTATION, AND ROTATION relative to the camera MUST adapt to the camera position described in the CAMERA ANGLE block — render the product as a real 3D object photographed from the camera position the scene calls for, showing whichever faces, sides, and surfaces would naturally be visible from that angle. Do NOT copy the reference image's viewing angle of the product if it differs from the scene's camera angle. Treat the reference image as a guide to the product's IDENTITY, not as a template for the product's pose.

ONE SINGLE 1:1 photograph. ZERO Mandarin / Chinese / Asian characters. NO HUMANS, NO PETS — implied presence only. NO alcohol, wine, cocktails, bar items.

INTERIOR WINDOWS — visible but soft: real trees, branches, hedges, pale soft sky. Brighter than interior but NOT pure white blown-out. Soft natural rolloff. AVOID: pure white blur, sharp dramatic clouds, vivid saturated skies.

`;

interface Scene { slug: string; prompt: string; }

const SCENES: Scene[] = [
  // 1) LOW-DOMESTIC-LOOK-UP × Cape Cod beach cottage living room (L55)
  // — naturally calls for the underside of the dome facing the camera.
  {
    slug: "v23_LOW_LOOK_UP_cape_cod_beadboard_living",
    prompt:
      "CAMERA ANGLE — LOW-DOMESTIC-LOOK-UP: Shot from a LOW camera position 3 ft off the floor (kitchen-counter / child eye-level). Lens WIDE-NORMAL 30mm. The fixture sits in the upper-left third of the frame, fixture-to-frame ratio DOMINANT at about 15 percent. Camera pitch UP 30 degrees so the bead-board ceiling fills the upper half of the frame. Deep depth-of-field. Reference: Schoolhouse Electric domestic-editorial signature. " +
      "POOL ANCHOR (Line 55): Cape Cod beach cottage living room with pale-blue bead-board ceiling and reclaimed pine floor — slipcovered ivory linen camelback sofa with cream-and-blue ticking-stripe cushions and a folded cream waffle-cotton throw; rope-handled vintage steamer trunk as coffee table holding a clear-glass hurricane with half-burned ivory taper, two cream-bound coastal monographs spine-out, a soft-blue stoneware vessel of sea-oat sprigs, and a brass-rim glass tumbler; striped cream-and-blue dhurrie rug; tall sash window with soft summer morning light, green dune grasses and pale-blue sky visible. The fixture is mounted to the bead-board ceiling in the upper-left third of the frame, switched ON with warm 2700-3000K glow. From this low up-looking camera position, the underside of the dome (the scalloped petal skirt-hem opening) faces the camera and is the prominent visible surface of the fixture. Designer-inhabited custom residence.",
  },
  // 2) DOWN-CORRIDOR-DEPTH-AXIS × English country hall (L256)
  // — three fixtures down the hall, foreground at slight up-3/4, far ones receding to side-profile.
  {
    slug: "v23_DOWN_CORRIDOR_english_country_hall",
    prompt:
      "CAMERA ANGLE — DOWN-CORRIDOR-DEPTH-AXIS: Shot from a STANDING camera position 5.25 ft off the floor at one end of a long English country hall, looking straight down its length. Lens WIDE 26mm with strong depth pull. There is a row of THREE identical fixtures mounted along the centerline of the hall ceiling, receding into depth. The foreground fixture occupies about 15 percent of the frame; the middle fixture is smaller; the far fixture is smaller still. Camera pitch very slight up 5 degrees so the ceiling line reads. Deep depth-of-field. Reference: Dazuma signature corridor-flush merch shot. " +
      "POOL ANCHOR (Line 256): English country hall with hand-laid herringbone red-brick floor stretching into depth, rough lime-washed pale-cream walls, low dark-stained oak beams crossing the ceiling between the fixtures (positioned so beams do NOT clip the fixtures); a scrubbed-pine console table against the left wall in the middle distance holds a large hand-thrown stoneware urn with cut spring branches and pale wildflowers, two cream-bound English-garden monographs spine-out, a worn leather visitor's book with a brass pen, and an antique-brass candle stick with a half-burned ivory taper; an antique English oak bench against the right wall further down with a folded soft-moss wool throw; a cream-and-soft-moss runner rug stretches the length; a tall sash window at the far end shows soft late-afternoon spring light with green-budding trees and pale-grey sky. The three fixtures along the ceiling are switched ON emitting warm 2700-3000K glow that pools on the lime-washed walls. As the fixtures recede down the corridor, each is seen at a different angle relative to the camera — the foreground fixture from a slight below-front-3/4 view, the middle fixture more oblique, the far fixture nearly in side profile. No two fixtures share an identical orientation; each rotates with perspective.",
  },
  // 3) CORNER-TWO-WALL-COMPOSITION × Loft brick + timber truss (L18)
  // — oblique side-3/4 of the fixture as the camera sits in the room corner.
  {
    slug: "v23_CORNER_TWO_WALL_loft_brick_timber_truss",
    prompt:
      "CAMERA ANGLE — CORNER-TWO-WALL-COMPOSITION: Shot from a STANDING camera position 5.25 ft off the floor positioned in the corner of the loft showing two adjacent walls meeting at the corner at a 30-45 degree oblique angle. Lens NORMAL-WIDE 35mm. Fixture-to-frame ratio about 10 percent, PROMINENT. Camera pitch level. Deep depth-of-field. Reference: Dazuma corner compositions; Pottery Barn layered framing. " +
      "POOL ANCHOR (Line 18): Loft living area with hand-laid red-brick masonry on one wall, lime-washed cream plaster on the adjacent wall meeting at a corner, timber-truss ceiling with exposed dark-stained pine beams above, polished concrete floor below — a deep buttoned dark-walnut leather chesterfield sofa anchors one side with cream wool and faded-brick velvet cushions and a folded cream cable-knit throw; a low antique iron-strapped chest as coffee table holding two cream-bound architectural monographs spine-out, a stoneware vessel of olive sprigs, a brass-rim glass tumbler, and an antique-brass candle stick with a half-burned ivory taper; a cream-and-brick-red dhurrie rug; a tall industrial steel-mullioned casement window with soft early-evening light and a deepening violet-grey sky. The fixture is mounted to the timber-truss ceiling in the upper portion of the frame at the corner where the two walls meet, switched ON with warm 2700-3000K glow. From this oblique corner camera position, the fixture is seen in side-3/4 view — one full side of the dome shade is the dominant visible surface, with the walnut canopy visible from below-side. Designer-inhabited custom residence.",
  },
  // 4) OFF-CENTER-THIRDS-RIGHT × Four-poster guest bedroom (L210)
  // — fixture in upper-right third with the camera offset to the left looking back-right.
  {
    slug: "v23_OFF_CENTER_THIRDS_RIGHT_bedroom",
    prompt:
      "CAMERA ANGLE — OFF-CENTER-THIRDS-RIGHT: Shot from a STANDING camera position 5 ft off the floor, positioned more toward the left side of the bedroom so the fixture mounted on the ceiling appears in the UPPER-RIGHT THIRD of the frame. Lens NORMAL-WIDE 35mm. Fixture-to-frame ratio about 10 percent, PROMINENT. Camera pitch level. Deep depth-of-field. Reference: Pottery Barn / Schoolhouse off-center editorial. " +
      "POOL ANCHOR (Line 210): French country bedroom with limewashed beams and limestone floor — a scrolled antique-iron bed with a soft cream linen duvet, two layered pillows in faded oat-and-cream stripe and pale-blush linen, and a folded soft-ochre cashmere throw at the foot; a slim limewashed-oak side table beside the bed with a small ironstone pitcher of dried wheat sprigs, a brass-and-tortoise reading lamp (switched off, decorative), a half-burned cream beeswax taper in an antique-brass holder, a stack of two cream-bound French-country monographs; a narrow limewashed armoire against the back wall; a pale linen drape pooling at the floor by a window inside the bedroom that shows soft golden-hour autumn light with visible bare ochre-leafed branches and a warm-amber sky. The fixture is mounted to the bedroom ceiling in the upper-right third of the frame, switched ON with warm 2700-3000K glow. From the camera's offset-left position, the fixture is seen in 3/4 view from below-left — the left side of the dome is the dominant visible surface, the right side rotated away. The left two-thirds of the frame are occupied by the bed and styled vignette. Designer-inhabited custom residence.",
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
  console.log(`Uploading reference...`);
  const refUrl = await uploadRef(REF, `_scene-refs/${stamp}-v23-${path.basename(REF)}`);
  console.log(`  ${path.basename(REF)} -> ${refUrl}`);
  const toRun = SCENES.filter((s) => !fs.existsSync(path.join(outDir, `${s.slug}.png`)));
  if (toRun.length === 0) { console.log("Nothing to generate."); return; }
  console.log(`\nFiring ${toRun.length} tasks at ${RESOLUTION}...`);
  const tasks = await Promise.all(toRun.map(async (s) => {
    const taskId = await kieCreateTask(GUARDRAILS + s.prompt, refUrl);
    console.log(`  [${s.slug}] ${taskId}`);
    return { s, taskId };
  }));
  console.log(`\nPolling...`);
  const results = await Promise.allSettled(tasks.map(async ({ s, taskId }) => {
    const buf = await kiePoll(taskId);
    fs.writeFileSync(path.join(outDir, `${s.slug}.png`), buf);
    return s;
  }));
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
