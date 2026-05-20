/**
 * One-off scene generator: takes 6 hardcoded lifestyle-scene prompts plus a
 * matte-black and a brushed-brass reference image, uploads the refs to
 * Supabase storage under a temp path, fires 6 parallel Nano Banana Pro
 * (kie.ai) tasks, downloads results to a local temp folder, and prints the
 * paths.
 *
 * No DB writes, no ProductImage rows, no Shopify side effects. Purely a
 * preview-to-temp utility.
 *
 * Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      SUPABASE_STORAGE_BUCKET (default product-images),
 *      SCENE_RESOLUTION (default "1K"; set to "2K" to upgrade — ~$0.09/img).
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

const REF_BRASS = path.join(os.tmpdir(), "scene", "ref5.jpg");
const REF_BLACK = path.join(os.tmpdir(), "scene", "ref7.jpg");

const SCENES: Array<{ slug: string; finish: "brass" | "black"; prompt: string }> = [
  {
    slug: "v3_1_gallery_hallway_straight_evening_black",
    finish: "black",
    prompt:
      "Wide gallery hallway on a 28mm lens, eye-level standing height, looking straight down the corridor. A coffered ceiling runs the full length above; deep crown molding meets tall paneled walls in soft warm white; herringbone white-oak floor stretches beneath a Persian runner showing subtle wear. A gallery wall along the right hangs five mixed frames — three small black-and-white travel photographs, an oil sketch, and a leaning framed antique mirror. A vintage wooden bench sits midway down with one folded linen pillow and an art book resting on its seat. A tall arched window at the far end shows cool blue early-evening light; warm-dimmed recessed cans glow in the ceiling. The fixture sits midway down the corridor, small against the broad coffered ceiling. The ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 10% of the frame. Slim round matte-black canopy flush to the coffered ceiling, single short square shade beneath, cage of vertical clear faceted crystal prisms around four matte-black corner posts, framed top and bottom in matte black. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. The fixture is small relative to the room — a delicate accent, never a statement piece. From across the hall it reads as a modest warm point of interest, not a dominant element. Architectural Digest custom residence, designer-inhabited, contemporary transitional.",
  },
  {
    slug: "v3_2_grand_entryway_eye_level_dusk_brass",
    finish: "brass",
    prompt:
      "A grand entryway on a 35mm lens, eye-level, slight 3/4 right angle, framing the room wide. A tall arched doorway frames the back with a paneled solid-walnut door and oversized matte-black hardware; deep crown molding meets the ceiling; paneled walls in soft warm white run wall-to-wall. A vintage honed-travertine console holds one sculptural ceramic vessel, an art book left face-down beside it, and a small unlacquered-brass dish with a single house key. A pair of well-worn leather loafers sits tucked beside the console; a camel trench coat hangs on a brass hook on the right wall; a vintage gilt mirror leans against the wall above the console rather than hanging. Soft dusk light filters in through a tall arched sidelite at camera-left; warm-dimmed recessed cans glow above. The ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 8% of the frame. Slim round brushed-brass canopy hugs the ceiling, single short square shade beneath, cage of vertical clear faceted crystal prisms around four brushed-brass corner posts, capped top and bottom in matching brass. One E27 bulb visible. Switched ON, gentle ambient warmth above the fixture with natural soft falloff. The fixture is small relative to the entry — a delicate accent, not a statement piece. From across the room it reads as a modest warm point, not a dominant element. Custom-built residence, designer-inhabited, layered.",
  },
  {
    slug: "v3_3_primary_suite_three_quarter_morning_black",
    finish: "black",
    prompt:
      "A primary suite on a 35mm lens, eye-level, strong 3/4 left angle, framed wide. A tray ceiling rises overhead with thin painted reveal trim; the back wall is a vertically-channeled oatmeal linen headboard wall. The bed enters at right with ivory linen bedding intentionally rumpled — not perfectly made, not messy — a charcoal wool throw at the foot, and a small honed-marble tray on the duvet holding a half-burned beeswax taper in a brass holder. A vintage walnut credenza sits beneath the fixture on the left, carrying a stack of two hardcover art books with a pair of tortoise reading glasses resting on top, a single dried branch in a stoneware vessel, and one small bronze sculpture. Linen drapes pulled to one side at the right wall let soft morning daylight pour in; recessed cans in the tray glow dim and warm. The ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 9% of the frame. Round matte-black canopy flush to the tray ceiling, single short square shade beneath, cage of vertical clear faceted crystal prisms around four slim matte-black corner posts, framed top and bottom in matte black. One E27 bulb visible. Switched ON, a soft warm 2700-3000K accent within the morning interior. The fixture is small relative to the suite — a delicate accent, never a statement piece. From across the room it reads as a modest warm point, not a dominant element. Designer-inhabited custom residence, serene, lived-in.",
  },
  {
    slug: "v3_4_stair_landing_wide_morning_brass",
    finish: "brass",
    prompt:
      "An open staircase landing on a 28mm lens, eye-level, slight 3/4 right angle, framed wide. A statement floor-to-ceiling steel-and-glass railing crosses the foreground; wide-plank quarter-sawn white-oak floor stretches across the landing; a tall floor-to-ceiling window above the stairwell pours cool mid-morning daylight in from camera-left; paneled walls in soft warm white climb to a coffered ceiling overhead. A small mid-century wooden chair sits tucked in the back corner with a folded charcoal wool throw across its seat. A large piece of muted-abstract art leans against the back wall rather than hangs, propped on the floor. A single smooth river stone rests on the wide windowsill beside a stoneware vase holding one olive branch. The ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 8% of the frame. Slim round brushed-brass canopy flush to the coffered ceiling, single short square shade beneath, cage of vertical clear faceted crystal prisms around four brushed-brass corner posts, capped top and bottom in matching brass. One E27 bulb visible. Switched ON, soft warm 2700-3000K glow on the surrounding ceiling. The fixture is small relative to the landing — a delicate accent, never a statement piece. From across the space it reads as a modest warm point, not a dominant element. Architectural Digest custom build, designer-inhabited.",
  },
  {
    slug: "v3_5_vaulted_living_room_evening_brass",
    finish: "brass",
    prompt:
      "A vaulted-ceiling living room on a 35mm lens, eye-level, mild 3/4 right angle, framed wide to show the full room. Exposed white-painted wood beams cross the high vault overhead; a linear gas fireplace runs the full back wall set into honed-travertine slab; an oversized oatmeal linen sofa carries a charcoal wool throw draped casually over one arm; a vintage cognac leather club chair sits at a 45-degree angle beside the sofa. A round walnut side table holds a half-full ceramic mug on a travertine coaster and a single olive branch in a stoneware vase; the corner of a low travertine coffee table enters the lower-right with one open art book left face-down and a stack of design monographs spine-out. A worn vintage kilim rug grounds the seating. Linen-draped floor-to-ceiling windows show the last cool dusk light; recessed cans within the vault glow dim and warm. The ceiling fixture is mounted between two beams, identical to the reference — a compact semi-flush mount occupying roughly 7% of the frame. Slim round brushed-brass canopy, single short square shade beneath, cage of vertical clear faceted crystal prisms around four brushed-brass corner posts, capped top and bottom in matching brass. One E27 bulb visible. Switched ON, soft warm 2700-3000K accent. The fixture is small relative to the vault — a delicate accent, never a statement piece. From across the room it reads as a modest warm point, never the visual focus. Designer-inhabited custom residence, lived-in, transitional.",
  },
  {
    slug: "v3_6_grand_entryway_three_quarter_morning_black",
    finish: "black",
    prompt:
      "A grand entryway on a 35mm lens, eye-level, strong 3/4 left angle. A tall arched doorway frames the back with a paneled solid-walnut door and oversized matte-black hardware; deep crown molding meets the ceiling; paneled walls in soft warm white run wall-to-wall; a herringbone white-oak floor stretches across the foreground beneath a worn-in woven jute runner. A vintage black-painted wooden bench sits against the right wall with a folded ivory linen throw on its seat, a soft leather tote leaning against the wall beside it, and a pair of well-worn leather slippers tucked underneath. A small 3-piece gallery wall of black-framed travel photographs hangs above the bench, and one small art book leans against the baseboard below. A tall arched sidelite at camera-right floods the foreground with bright mid-morning daylight; warm-dimmed recessed cans glow in the ceiling. The ceiling fixture is identical to the reference — a compact semi-flush mount occupying roughly 9% of the frame. Slim round matte-black canopy flush to the ceiling, single short square shade beneath, cage of vertical clear faceted crystal prisms around four slim matte-black corner posts, framed top and bottom in matte black. One E27 bulb visible. Switched ON, gentle ambient warmth above the fixture. The fixture is small relative to the entryway — a delicate accent, never a statement piece. From across the room it reads as a modest warm point, not a dominant element. Custom residence, designer-inhabited, clean transitional.",
  },
];

const GUARDRAILS = `ABSOLUTE REQUIREMENT — PRODUCT FIDELITY:
The reference image shows the exact fixture that must appear in the output. Replicate its shape, proportions, the cage of vertical clear faceted crystal prisms, the canopy silhouette, the bulb visible inside, and the metal-finish character. Do NOT invent a different fixture, do NOT change the silhouette, do NOT add ornamentation not present in the reference.

OUTPUT FORMAT — ONE SINGLE PHOTOGRAPH (not a collage, not a grid, not a triptych, not a mood board). A single 1:1 rectangular photograph.

US MARKET RULE — Western American home interior. ZERO Mandarin / Chinese / Asian characters anywhere in the frame. Any visible text must be English or abstract.

NO CAMERA / PHONE UI — no shutter button, no app chrome, no status bar, no viewfinder overlay. The image is the photograph itself, edge-to-edge.

CLEANLINESS — every surface clean and cared-for. No grime, no peeling paint, no scratches, no clutter. Lived-in means asymmetric and thoughtful, NOT dirty.

`;

interface KieCreateResp {
  code?: number;
  msg?: string;
  data?: { taskId?: string };
}
interface KiePollResp {
  code?: number;
  msg?: string;
  data?: {
    state?: string;
    failMsg?: string;
    failCode?: string;
    resultJson?: string;
  };
}

async function kieCreateTask(prompt: string, imageUrl: string): Promise<string> {
  const token = process.env.KIE_API_KEY!;
  const res = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt,
        image_input: [imageUrl],
        aspect_ratio: "1:1",
        resolution: RESOLUTION,
        output_format: "png",
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`kie createTask HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
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
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
      continue;
    }
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
    if (state === "fail") {
      throw new Error(`kie failed: ${json.data?.failMsg || json.data?.failCode || "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
  }
  throw new Error(`kie poll timeout after ${KIE_TIMEOUT_MS / 1000}s`);
}

async function uploadRefToSupabase(localPath: string, remotePath: string): Promise<string> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(url, key, { auth: { persistSession: false } });
  const data = fs.readFileSync(localPath);
  const { error } = await client.storage.from(BUCKET).upload(remotePath, data, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data: pub } = client.storage.from(BUCKET).getPublicUrl(remotePath);
  return pub.publicUrl;
}

async function main() {
  if (!process.env.KIE_API_KEY) throw new Error("KIE_API_KEY not set");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }

  const outDir = path.join(os.tmpdir(), "scene", "output");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Uploading reference images to Supabase bucket '${BUCKET}'...`);
  const stamp = Date.now();
  const [brassUrl, blackUrl] = await Promise.all([
    uploadRefToSupabase(REF_BRASS, `_scene-refs/${stamp}-brass.jpg`),
    uploadRefToSupabase(REF_BLACK, `_scene-refs/${stamp}-black.jpg`),
  ]);
  console.log("  brass ref:", brassUrl);
  console.log("  black ref:", blackUrl);

  const toRun = SCENES.filter((s) => {
    const outPath = path.join(outDir, `${s.slug}.png`);
    if (fs.existsSync(outPath)) {
      console.log(`  [skip] ${s.slug} (output already exists)`);
      return false;
    }
    return true;
  });
  if (toRun.length === 0) {
    console.log("\nNothing to generate — all outputs already exist. Delete files in the output folder to regenerate.");
    return;
  }

  console.log(`\nFiring ${toRun.length} Nano Banana Pro task(s) at ${RESOLUTION} resolution...`);
  const tasks = await Promise.all(
    toRun.map(async (s) => {
      const imageUrl = s.finish === "brass" ? brassUrl : blackUrl;
      const taskId = await kieCreateTask(GUARDRAILS + s.prompt, imageUrl);
      console.log(`  [${s.slug}] taskId=${taskId}`);
      return { s, taskId };
    }),
  );

  console.log(`\nPolling all 6 tasks in parallel (timeout ${KIE_TIMEOUT_MS / 1000}s each)...`);
  const results = await Promise.allSettled(
    tasks.map(async ({ s, taskId }) => {
      const buf = await kiePoll(taskId);
      const outPath = path.join(outDir, `${s.slug}.png`);
      fs.writeFileSync(outPath, buf);
      return { s, outPath };
    }),
  );

  console.log(`\nResults (saved under ${outDir}):`);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const slug = toRun[i].slug;
    if (r.status === "fulfilled") {
      console.log(`  OK   ${slug} -> ${r.value.outPath}`);
      ok++;
    } else {
      console.log(`  FAIL ${slug} -> ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      fail++;
    }
  }
  console.log(`\nDone. ${ok} succeeded, ${fail} failed. Folder: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
