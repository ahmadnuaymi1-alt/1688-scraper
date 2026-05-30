/**
 * Step-light lifestyle rebuild — parallel everything.
 *
 *   Phase A: generate 6 editorial scene prompts per product via Claude
 *            (in parallel across all 4 products). Editorial publication
 *            framing (Dwell / AD / Kinfolk / Wallpaper* / Garden & Gun /
 *            Cereal) with the product treated as a generic small fixture,
 *            placed naturally in real architectural / outdoor contexts.
 *            Writes scene-overrides/<productId>.json.
 *   Phase B: wipe existing lifestyles for all 4 in parallel.
 *   Phase C: spawn _lifestyle-image-creator.ts for all 4 in parallel
 *            via Promise.all (the script picks up the override file
 *            and uses it verbatim).
 *   Phase D: apply gallery preset for all 4 in parallel.
 *
 * Total target wall time: ~6-8 min (vs the 21m 35s sequential run earlier).
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { claudeText } from "../src/lib/ai/claude-client";

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

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const PRODUCTS: Array<{ id: string; setting: "indoor" | "outdoor"; description: string }> = [
  { id: "cmpr75j2m0085w2wo50ou3h12", setting: "outdoor", description: "Outdoor waterproof LED step / path light, 3 cover colors (black/gray/white). Surface-mount low-voltage fixture for garden paths, deck stairs, patio steps." },
  { id: "cmpr6s8zm001vw2wotdxrwpcb", setting: "indoor", description: "86mm recessed indoor LED step light with motion sensor option. Sits flush in the wall at ankle/shin height alongside hotel corridors, residential staircases, hallway baseboards." },
  { id: "cmpr6sedo002vw2wog3u1ojmh", setting: "indoor", description: "Frameless rim-less COB indoor step light, recessed flush into the wall. Square or rectangular face. Sits at ankle height along hallway baseboards, hotel corridors, modern home staircases, basement / wine cellar entries." },
  { id: "cmpr76js200a9w2wof4taoa36", setting: "outdoor", description: "Solar-powered outdoor stair / path / garden / balcony light. Surface-mount on stair risers, deck edges, garden walls, patio steps. Charges in daylight, glows softly at dusk." },
];

const prisma = new PrismaClient();
const supabase = (() => {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
})();

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Phase A: generate scene prompts via Claude ─────────────────────────────

const SCENE_SYSTEM_PROMPT = `You are designing 6 editorial / marketing lifestyle scene prompts for a small architectural step light, treated as a GENERIC PRODUCT placed naturally in real contexts — NOT as a specialty lighting hero.

Each scene must be a self-contained text-to-image prompt that:
1. Opens with an editorial publication framing line (e.g. "Commissioned editorial photography for Dwell magazine, modern-architecture spread; NOT a product render, NOT advertising, NOT stock.").
2. Specifies a Hasselblad camera + lens + aperture for credibility.
3. Sets a real architectural or outdoor context where step lights are genuinely used (stair runs, garden paths, hotel corridors, deck edges, baseboards). The product sits at ankle / floor level and reads as a small integrated element, not the visual hero.
4. Names CONCRETE IMPERFECTIONS (chipped paint, water staining, dust film, scuff marks, weathered wood grain, etc.).
5. REJECTS cinematic AI balance — bright areas clip, shadows stay dark, exposure is committed.
6. Specifies ZERO color cast — warm sources stay local, cool sources stay local, surfaces read true.
7. Specifies Kodak Portra 400 film grain + 1-3% corner vignette + 1-2 px chromatic aberration at brightest edges.
8. Closes with the variant-match line: "The fixture matches the variant reference image exactly — finish and form as shown."
9. Names the palette (4-5 colours) and "No people, no alcohol."

Each scene is 150-220 words. Pick a DISTINCT publication for each of the 6 scenes from this menu: Dwell, Architectural Digest, T Magazine, Kinfolk, Wallpaper*, Garden & Gun, Cereal, Apartment Therapy, House & Garden, World of Interiors. Pair each publication with a contextually correct setting for the product.

Return ONLY valid JSON of this shape — no markdown fences, no commentary:
{
  "scenes": [
    {
      "slug": "publication-context-kebab",
      "mode": "minimalist" | "homey",
      "prompt": "<the full 150-220 word scene prompt>",
      "variantSlot": 1,
      "room": "<short label, e.g. 'modern home staircase landing'>",
      "designStyle": "<publication name + style hook>",
      "cameraAngle": "<short label>",
      "timeOfDay": "<short label>",
      "accents": ["<short detail>", "<short detail>", "<short detail>"]
    },
    ... 6 total ...
  ]
}

variantSlot is 1-based (1..6) — assign each scene to a distinct slot.`;

async function generateScenes(productId: string, setting: "indoor" | "outdoor", description: string): Promise<unknown> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, descriptionHtml: true },
  });
  if (!product) throw new Error(`product ${productId} not found`);
  const plainDesc = (product.descriptionHtml ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  const user = `PRODUCT
Title: ${product.title}
Setting: ${setting}
Use-case context: ${description}
Description excerpt (HTML stripped): ${plainDesc || "(none)"}

Generate the 6 scenes now. Return ONLY the JSON object.`;
  const raw = await claudeText({
    model: "claude-sonnet-4-6",
    system: SCENE_SYSTEM_PROMPT,
    user,
    temperature: 0.6,
    maxTokens: 8000,
  });
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function writeOverride(productId: string, setting: string, scenes: unknown): void {
  const doc = {
    productId,
    productTitle: `Step-light editorial scenes (${setting})`,
    authoredBy: "step-light-parallel-rebuild script — generic-product editorial framing per user instruction",
    authoredAt: new Date().toISOString(),
    classification: setting,
    category: "outdoor", // routes through outdoor scene pool internally; overrides take precedence anyway
    ...((scenes as object) ?? {}),
  };
  const file = path.resolve("scene-overrides", `${productId}.json`);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
}

// ── Phase B: wipe lifestyles ────────────────────────────────────────────────
async function wipeLifestyles(productId: string): Promise<number> {
  const rows = await prisma.productImage.findMany({
    where: { productId, imageType: "lifestyle" },
    select: { id: true, storagePath: true },
  });
  if (rows.length === 0) return 0;
  const paths = rows.map((r) => r.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.warn(`  storage rm warn: ${error.message}`);
  }
  const r = await prisma.productImage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return r.count;
}

// ── Phase C: spawn lifestyle generator per product ─────────────────────────
function spawnLifestyle(productId: string): Promise<{ id: string; code: number; ms: number }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_lifestyle-image-creator.ts", productId, "--headed"],
      { stdio: "pipe", shell: true },
    );
    let buf = "";
    proc.stdout.on("data", (d) => { buf += d.toString(); });
    proc.stderr.on("data", (d) => { buf += d.toString(); });
    proc.on("close", (code) => {
      // Surface the tail of the log for visibility.
      const lines = buf.split(/\r?\n/);
      const tail = lines.slice(-12).join("\n");
      console.log(`\n--- ${productId} (exit ${code}, ${fmt(Date.now() - t)}) ---\n${tail}`);
      resolve({ id: productId, code: code ?? -1, ms: Date.now() - t });
    });
    proc.on("error", (err) => {
      console.error(`[spawn ${productId}] ${err.message}`);
      resolve({ id: productId, code: -1, ms: Date.now() - t });
    });
  });
}

// ── Phase D: apply gallery preset ──────────────────────────────────────────
async function applyPreset(cookie: string, productId: string): Promise<{ id: string; ok: boolean; body: string }> {
  const res = await fetch(`http://localhost:3000/api/products/${productId}/apply-gallery-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
  });
  return { id: productId, ok: res.ok, body: (await res.text()).slice(0, 150) };
}

// ── Driver ─────────────────────────────────────────────────────────────────
(async () => {
  const totalStart = Date.now();
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync("step-light-parallel-rebuild.log", line + "\n");
  };

  log(`=== START step-light parallel rebuild (${PRODUCTS.length} products) ===`);

  // Phase A
  log(`Phase A: generating editorial scene prompts via Claude in parallel...`);
  const aStart = Date.now();
  await Promise.all(
    PRODUCTS.map(async (p) => {
      const tStart = Date.now();
      try {
        const scenes = await generateScenes(p.id, p.setting, p.description);
        writeOverride(p.id, p.setting, scenes);
        log(`  ${p.id}: override written (${fmt(Date.now() - tStart)})`);
      } catch (err) {
        log(`  ${p.id}: GEN FAIL ${err instanceof Error ? err.message : err}`);
      }
    }),
  );
  log(`Phase A done in ${fmt(Date.now() - aStart)}`);

  // Phase B
  log(`Phase B: wiping existing lifestyles in parallel...`);
  const bStart = Date.now();
  await Promise.all(
    PRODUCTS.map(async (p) => {
      const n = await wipeLifestyles(p.id);
      log(`  ${p.id}: wiped ${n} lifestyle row(s)`);
    }),
  );
  log(`Phase B done in ${fmt(Date.now() - bStart)}`);

  // Phase C — TRUE parallel
  log(`Phase C: firing lifestyle generator for ${PRODUCTS.length} products in PARALLEL...`);
  const cStart = Date.now();
  const cResults = await Promise.all(PRODUCTS.map((p) => spawnLifestyle(p.id)));
  log(`Phase C done in ${fmt(Date.now() - cStart)}`);
  for (const r of cResults) log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);

  // Phase D
  log(`Phase D: applying gallery preset in parallel...`);
  const dStart = Date.now();
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DEV_EMAIL || "ahmadnuaymi1@gmail.com",
      password: process.env.DEV_PASSWORD || "Malak2010",
    }),
  });
  const m = (loginRes.headers.get("set-cookie") || "").match(/scraper_1688_session=[^;]+/);
  if (!m) {
    log(`  Login failed — preset must be applied manually`);
  } else {
    const cookie = m[0];
    const dResults = await Promise.all(PRODUCTS.map((p) => applyPreset(cookie, p.id)));
    for (const r of dResults) log(`  ${r.id} ${r.ok ? "OK" : "FAIL"} ${r.body}`);
  }
  log(`Phase D done in ${fmt(Date.now() - dStart)}`);

  log(`\n=== TOTAL ${fmt(Date.now() - totalStart)} ===`);
  await prisma.$disconnect();
})();
