/**
 * 5-product step-light driver.
 *
 * Phase 1 — get the new 5th product (cmpracqg8) to parity with the other 4:
 *           1A. Generate scene-override JSON via Claude + generate heroes
 *               via bulk-heroes (PARALLEL).
 *           1B. Generate editorial lifestyles for cmpracqg8 using the override.
 *
 * Phase 2 — run lifestyle-from-lifestyle on ALL 5 products in parallel.
 *           Picks each product's lowest-position lifestyle as the reference,
 *           wipes the rest, generates 6 new with minimal prompts + 6 angles.
 *
 * Phase 3 — gallery preset on all 5 in parallel.
 *
 * Sequential between phases; everything within a phase is parallel.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
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

const ALL_IDS = [
  "cmpr75j2m0085w2wo50ou3h12",
  "cmpr6s8zm001vw2wotdxrwpcb",
  "cmpr6sedo002vw2wog3u1ojmh",
  "cmpr76js200a9w2wof4taoa36",
  "cmpracqg800dhw2wovkxyax4d", // new 5th
];
const NEW_PRODUCT = "cmpracqg800dhw2wovkxyax4d";

const prisma = new PrismaClient();

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function runScript(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", ...args], { stdio: "inherit", shell: true });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => { console.error(`spawn: ${err.message}`); resolve(-1); });
  });
}

// ── Editorial scene prompt (shared with the earlier rebuild script) ─────────
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
      "room": "<short label>",
      "designStyle": "<publication name + style hook>",
      "cameraAngle": "<short label>",
      "timeOfDay": "<short label>",
      "accents": ["<detail>", "<detail>", "<detail>"]
    },
    ... 6 total ...
  ]
}

variantSlot is 1-based (1..6) — assign each scene to a distinct slot.`;

async function generateOverride(productId: string, setting: "outdoor"): Promise<void> {
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
Use-case context: Outdoor solar-powered step / stair / garden / balcony / fence light. Surface-mount on stair risers, deck edges, garden walls, patio steps. Charges in daylight, glows softly at dusk.
Description excerpt: ${plainDesc || "(none)"}

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
  const scenes = JSON.parse(cleaned);
  const doc = {
    productId,
    productTitle: `Step-light editorial scenes (${setting})`,
    authoredBy: "step-light-5-products-driver",
    authoredAt: new Date().toISOString(),
    classification: setting,
    category: "outdoor",
    ...scenes,
  };
  fs.writeFileSync(
    path.resolve("scene-overrides", `${productId}.json`),
    JSON.stringify(doc, null, 2),
  );
}

// ── Phase 3: gallery preset ────────────────────────────────────────────────
async function applyPreset(cookie: string, productId: string): Promise<{ id: string; ok: boolean; body: string }> {
  const res = await fetch(`http://localhost:3000/api/products/${productId}/apply-gallery-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
  });
  return { id: productId, ok: res.ok, body: (await res.text()).slice(0, 150) };
}

(async () => {
  const totalStart = Date.now();
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync("step-light-5-products.log", line + "\n");
  };

  log(`=== START 5-product step-light driver ===`);

  // PHASE 1A — generate override JSON for 5th + bulk heroes for 5th (parallel)
  log(`Phase 1A: scene-override + heroes for new 5th product (parallel)`);
  const p1aStart = Date.now();
  await Promise.all([
    generateOverride(NEW_PRODUCT, "outdoor").then(() => log(`  override JSON written for ${NEW_PRODUCT}`)),
    runScript(["scripts/_hf-cli-bulk-heroes.ts", "--products", NEW_PRODUCT]).then((c) =>
      log(`  bulk-heroes for ${NEW_PRODUCT} exit ${c}`),
    ),
  ]);
  log(`Phase 1A done in ${fmt(Date.now() - p1aStart)}`);

  // PHASE 1B — editorial lifestyles for 5th
  log(`Phase 1B: editorial lifestyles for ${NEW_PRODUCT}`);
  const p1bStart = Date.now();
  const p1bCode = await runScript(["scripts/_lifestyle-image-creator.ts", NEW_PRODUCT, "--headed"]);
  log(`Phase 1B done in ${fmt(Date.now() - p1bStart)} (exit ${p1bCode})`);

  // PHASE 2 — lifestyle-from-lifestyle on ALL 5 in parallel
  log(`Phase 2: lifestyle-from-lifestyle on ALL 5 products in PARALLEL`);
  const p2Start = Date.now();
  const p2Code = await runScript([
    "scripts/_lifestyle-from-lifestyle.ts",
    "--products",
    ALL_IDS.join(","),
  ]);
  log(`Phase 2 done in ${fmt(Date.now() - p2Start)} (exit ${p2Code})`);

  // PHASE 3 — gallery preset on all 5 in parallel
  log(`Phase 3: gallery preset on all 5 in parallel`);
  const p3Start = Date.now();
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
    const presetResults = await Promise.all(ALL_IDS.map((id) => applyPreset(cookie, id)));
    for (const r of presetResults) log(`  ${r.id} ${r.ok ? "OK" : "FAIL"} ${r.body}`);
  }
  log(`Phase 3 done in ${fmt(Date.now() - p3Start)}`);

  log(`\n=== TOTAL ${fmt(Date.now() - totalStart)} ===`);
  await prisma.$disconnect();
})();
