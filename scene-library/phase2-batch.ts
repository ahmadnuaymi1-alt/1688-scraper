/**
 * Phase 2 batch orchestration — for the parallel-subagent describe run.
 *
 * Deterministic: does NO vision work itself. It (a) splits the undescribed
 * scene images into chunk files for Claude Code subagents to process, and
 * (b) validates + QA-scans + merges the subagents' output back into the
 * metadata sidecars. Keeping the precise JSON merge in code (not in an LLM
 * run 945 times) is what keeps the result accurate.
 *
 *   npx tsx scene-library/phase2-batch.ts --prep
 *   npx tsx scene-library/phase2-batch.ts --prep --redo=scene-library/_phase2/qa-flagged.txt
 *   npx tsx scene-library/phase2-batch.ts --merge
 *
 * Agents write per-image artifacts to scene-library/_phase2/out/{image_id}.json
 * as { image_id, description, tags }. --merge folds those into the real
 * sidecars and deletes any invalid artifact so --prep re-dispatches it.
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve("scene-library");
const SOURCES = path.join(ROOT, "sources");
const CURATED = path.join(ROOT, "curated");
const BRANDS = ["dazuma", "vakker"];
const P2 = path.join(ROOT, "_phase2");
const CHUNKS_DIR = path.join(P2, "chunks");
const OUT_DIR = path.join(P2, "out");
const CHUNK_SIZE = 25;

const CLOSING_MARKER =
  "A lighting fixture matching the product reference image is installed naturally";
const REQUIRED_TAG_KEYS = [
  "room_type", "mood", "density", "color_palette_dominant", "color_accent",
  "primary_wood", "primary_metal", "architectural_features", "aesthetic_flavor",
  "product_category_fit", "camera_height", "lens_character", "composition",
  "hero_position_clarity", "secondary_fixtures_status",
];
// Fixture-object words (Phase 3 RULE 5), as word-boundary regexes so effect
// words ("lamplight", "lamplit") and innocuous overloads ("bulbous" vase,
// tree "canopy", window "shade") are not false-flagged.
const FIXTURE_PATTERNS: Array<[string, RegExp]> = [
  ["chandelier", /\bchandeliers?\b/],
  ["pendant", /\bpendants?\b/],
  ["sconce", /\bsconces?\b/],
  ["lampshade", /\blamp ?shades?\b/],
  ["light fixture", /\blight fixtures?\b/],
  ["luminaire", /\bluminaires?\b/],
  ["lamp", /\blamps?\b/],
  ["bulb", /\bbulbs?\b/],
];
const ANGLE_RE =
  /camera|eye[- ]level|lens|composition|three-quarter|looking down|looking up|elevated|wide-angle|telephoto|vantage|vignette/;

const imageIdOf = (file: string) => path.basename(file).replace(/\.[^.]+$/, "");
const brandOf = (imageId: string) => imageId.split("-")[0];

/** Map every source image_id -> its image path. */
async function scanSourceImages(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const brand of BRANDS) {
    const dir = path.join(SOURCES, brand);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!/\.(jpg|jpeg|png|webp)$/i.test(f)) continue;
      map.set(imageIdOf(f), path.join(dir, f));
    }
  }
  return map;
}

async function sidecarHasDescription(imageId: string): Promise<boolean> {
  const p = path.join(SOURCES, brandOf(imageId), `${imageId}.json`);
  try {
    const meta = JSON.parse(await readFile(p, "utf8"));
    return typeof meta.description === "string" && meta.description.trim().length > 0;
  } catch {
    return false;
  }
}

// ── --prep ─────────────────────────────────────────────────────────────

async function prep(redoFile: string | null) {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(CHUNKS_DIR, { recursive: true, force: true });
  await mkdir(CHUNKS_DIR, { recursive: true });

  const idToPath = await scanSourceImages();
  let todoIds: string[];

  if (redoFile) {
    const ids = (await readFile(redoFile, "utf8"))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Force a redo: delete any existing artifact so agents regenerate it.
    for (const id of ids) await rm(path.join(OUT_DIR, `${id}.json`), { force: true });
    todoIds = ids.filter((id) => idToPath.has(id));
    console.log(`[prep] redo mode: ${todoIds.length} id(s) from ${redoFile}`);
  } else {
    todoIds = [];
    for (const id of idToPath.keys()) {
      if (existsSync(path.join(OUT_DIR, `${id}.json`))) continue; // artifact already produced
      if (await sidecarHasDescription(id)) continue; // already merged
      todoIds.push(id);
    }
    console.log(`[prep] ${todoIds.length} image(s) still need describing`);
  }

  todoIds.sort();
  let chunkCount = 0;
  for (let i = 0; i < todoIds.length; i += CHUNK_SIZE) {
    const lines = todoIds
      .slice(i, i + CHUNK_SIZE)
      .map((id) => idToPath.get(id)!)
      .join("\n");
    const name = `chunk-${String(chunkCount).padStart(3, "0")}.txt`;
    await writeFile(path.join(CHUNKS_DIR, name), lines + "\n");
    chunkCount++;
  }
  console.log(
    `[prep] wrote ${chunkCount} chunk file(s) of up to ${CHUNK_SIZE} images -> ${CHUNKS_DIR}`,
  );
  if (chunkCount === 0) console.log("[prep] nothing to do — all images described.");
}

// ── --merge ────────────────────────────────────────────────────────────

function validateOut(parsed: unknown): { ok: boolean; reason: string } {
  const p = parsed as { description?: unknown; tags?: Record<string, unknown> };
  if (!p || typeof p !== "object") return { ok: false, reason: "not-object" };
  if (typeof p.description !== "string" || !p.description.trim())
    return { ok: false, reason: "no-description" };
  const wc = p.description.trim().split(/\s+/).filter(Boolean).length;
  if (wc < 100) return { ok: false, reason: `short(${wc}w)` };
  if (
    !p.description.includes(CLOSING_MARKER) ||
    !p.description.trim().endsWith("design details.")
  )
    return { ok: false, reason: "bad-closing" };
  if (!p.tags || typeof p.tags !== "object") return { ok: false, reason: "no-tags" };
  const missing = REQUIRED_TAG_KEYS.filter((k) => !(k in (p.tags as object)));
  if (missing.length) return { ok: false, reason: `missing-tags[${missing.join(",")}]` };
  return { ok: true, reason: "" };
}

/** Returns QA issues found in a description (empty = clean). */
function qaScan(description: string): string[] {
  let body = description;
  const idx = body.indexOf(CLOSING_MARKER);
  if (idx >= 0) body = body.slice(0, idx);
  const lower = body.toLowerCase();
  const issues: string[] = [];
  const hits = FIXTURE_PATTERNS.filter(([, re]) => re.test(lower)).map(([w]) => w);
  if (hits.length) issues.push(`fixture-words[${hits.join(",")}]`);
  if (!ANGLE_RE.test(lower)) issues.push("no-angle");
  return issues;
}

async function merge() {
  await mkdir(P2, { recursive: true });
  let merged = 0;
  let discarded = 0;
  const qaFlagged: string[] = [];

  let outFiles: string[] = [];
  try {
    outFiles = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    /* no out dir yet */
  }

  for (const f of outFiles) {
    const outPath = path.join(OUT_DIR, f);
    let parsed: { image_id?: string; description?: string; tags?: unknown };
    try {
      parsed = JSON.parse(await readFile(outPath, "utf8"));
    } catch {
      await rm(outPath, { force: true });
      discarded++;
      console.warn(`  discard ${f}: invalid JSON`);
      continue;
    }
    const v = validateOut(parsed);
    if (!v.ok) {
      await rm(outPath, { force: true });
      discarded++;
      console.warn(`  discard ${f}: ${v.reason}`);
      continue;
    }
    const imageId = parsed.image_id || f.replace(/\.json$/, "");
    const sidecarPath = path.join(SOURCES, brandOf(imageId), `${imageId}.json`);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(await readFile(sidecarPath, "utf8"));
    } catch {
      console.warn(`  skip ${imageId}: sidecar not found`);
      continue;
    }
    meta.description = parsed.description!.trim();
    meta.tags = parsed.tags;
    meta.vision_model = "claude-sonnet-4-6";
    meta.described_via = "claude-code-agent";
    meta.described_date = new Date().toISOString();
    await writeFile(sidecarPath, JSON.stringify(meta, null, 2));
    merged++;

    const issues = qaScan(meta.description as string);
    if (issues.length) qaFlagged.push(`${imageId}  ${issues.join(" ")}`);
  }

  // Recompute remaining work.
  const idToPath = await scanSourceImages();
  const missing: string[] = [];
  let described = 0;
  for (const id of idToPath.keys()) {
    if (await sidecarHasDescription(id)) described++;
    else missing.push(id);
  }
  missing.sort();

  await writeFile(
    path.join(P2, "qa-flagged.txt"),
    qaFlagged.map((s) => s.split(/\s+/)[0]).join("\n") + (qaFlagged.length ? "\n" : ""),
  );
  await writeFile(
    path.join(P2, "missing.txt"),
    missing.join("\n") + (missing.length ? "\n" : ""),
  );

  console.log(`\n[merge] merged ${merged} | discarded invalid artifacts ${discarded}`);
  console.log(
    `[merge] library described: ${described}/${idToPath.size} | still missing: ${missing.length}`,
  );
  console.log(`[merge] QA-flagged: ${qaFlagged.length} (ids -> _phase2/qa-flagged.txt)`);
  for (const s of qaFlagged.slice(0, 30)) console.log(`    ${s}`);
  if (qaFlagged.length > 30) console.log(`    ...and ${qaFlagged.length - 30} more`);
}

/** Re-scan all merged sidecars for QA issues; rewrite qa-flagged + missing lists. */
async function qa() {
  await mkdir(P2, { recursive: true });
  const idToPath = await scanSourceImages();
  const flagged: string[] = [];
  const missing: string[] = [];
  let described = 0;
  for (const id of idToPath.keys()) {
    const p = path.join(SOURCES, brandOf(id), `${id}.json`);
    let meta: { description?: unknown };
    try {
      meta = JSON.parse(await readFile(p, "utf8"));
    } catch {
      missing.push(id);
      continue;
    }
    if (typeof meta.description !== "string" || !meta.description.trim()) {
      missing.push(id);
      continue;
    }
    described++;
    const issues = qaScan(meta.description);
    if (issues.length) flagged.push(`${id}  ${issues.join(" ")}`);
  }
  missing.sort();
  await writeFile(
    path.join(P2, "qa-flagged.txt"),
    flagged.map((s) => s.split(/\s+/)[0]).join("\n") + (flagged.length ? "\n" : ""),
  );
  await writeFile(
    path.join(P2, "missing.txt"),
    missing.join("\n") + (missing.length ? "\n" : ""),
  );
  const byWord: Record<string, number> = {};
  for (const f of flagged) {
    const m = f.match(/fixture-words\[([^\]]+)\]/);
    if (m) for (const w of m[1].split(",")) byWord[w] = (byWord[w] ?? 0) + 1;
    if (/no-angle/.test(f)) byWord["no-angle"] = (byWord["no-angle"] ?? 0) + 1;
  }
  console.log(
    `[qa] described ${described}/${idToPath.size} | missing ${missing.length} | QA-flagged ${flagged.length}`,
  );
  console.log(`[qa] flag breakdown:`, JSON.stringify(byWord));
}

// ── --retag : derive source_hero_position for every sidecar ────────────

/** Last segment of a "A > B > C" category path. */
function leafOf(pt: string): string {
  const parts = pt.split(/[>›/|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : pt;
}

/**
 * Where the source photo's primary fixture lived — derived deterministically
 * from the scraped source product type + title (the ground-truth identity of
 * the fixture in the source image), so no vision re-run is needed.
 */
function heroPositionOf(
  title: string,
  productType: string,
): "ceiling" | "wall" | "table" | "floor" {
  const t = `${title} ${leafOf(productType)}`.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  if (has("壁灯", "sconce", "wall lamp", "wall light", "wall-mounted", "vanity light", "picture light", "wall lantern"))
    return "wall";
  if (has("吸顶", "flush mount", "flush-mount", "semi-flush", "chandelier", "pendant", "吊灯", "hanging light", "hanging lamp", "suspension", "ceiling light", "ceiling lamp", "ceiling fan"))
    return "ceiling";
  if (has("落地灯", "floor lamp", "floor-lamp", "standing lamp", "torchiere", "path light", "pathway light", "post light", "pillar light", "bollard", "landscape light", "garden light", "lawn lamp"))
    return "floor";
  if (has("台灯", "table lamp", "desk lamp", "bedside lamp", "accent lamp")) return "table";
  if (t.includes("lamp") && !t.includes("ceiling")) return "table";
  return "ceiling";
}

async function retag() {
  const counts: Record<string, number> = {};
  let updated = 0;
  let skipped = 0;
  for (const brand of BRANDS) {
    const dir = path.join(SOURCES, brand);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const p = path.join(dir, f);
      let meta: { tags?: Record<string, unknown>; description?: unknown; source_title?: string; source_product_type?: string };
      try {
        meta = JSON.parse(await readFile(p, "utf8"));
      } catch {
        continue;
      }
      if (!meta.tags || typeof meta.description !== "string") {
        skipped++;
        continue;
      }
      const pos = heroPositionOf(meta.source_title ?? "", meta.source_product_type ?? "");
      meta.tags.source_hero_position = pos;
      await writeFile(p, JSON.stringify(meta, null, 2));
      counts[pos] = (counts[pos] ?? 0) + 1;
      updated++;
    }
  }
  console.log(`[retag] updated ${updated} sidecar(s) | skipped ${skipped} (no description)`);
  console.log(`[retag] source_hero_position counts:`, JSON.stringify(counts));
}

/** Merge agent-cleaned descriptions (ADDITION 3 overhead-lighting scrub). */
async function scrubMerge() {
  const dir = path.join(P2, "scrub-out");
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    /* no scrub-out dir */
  }
  let merged = 0;
  let skipped = 0;
  for (const f of files) {
    let art: { image_id?: string; description?: unknown };
    try {
      art = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    } catch {
      skipped++;
      console.warn(`  skip ${f}: invalid JSON`);
      continue;
    }
    const desc = art.description;
    if (
      typeof desc !== "string" ||
      desc.trim().split(/\s+/).filter(Boolean).length < 100 ||
      !desc.trim().endsWith("design details.")
    ) {
      skipped++;
      console.warn(`  skip ${f}: description failed validation`);
      continue;
    }
    const id = art.image_id || f.replace(/\.json$/, "");
    const sidecar = path.join(SOURCES, brandOf(id), `${id}.json`);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(await readFile(sidecar, "utf8"));
    } catch {
      skipped++;
      continue;
    }
    meta.description = desc.trim();
    await writeFile(sidecar, JSON.stringify(meta, null, 2));
    merged++;
  }
  console.log(`[scrub-merge] merged ${merged} cleaned description(s) | skipped ${skipped}`);
}

// ── --retag2 : re-judge hero_prominence + strict secondary via vision ──
//
// REFINEMENT pass. The curated library was described before the strict
// `secondary_fixtures_status` definition and the new `hero_prominence` tag
// existed. This re-judges both for every curated scene's SOURCE image via a
// focused Claude Code subagent vision pass. Agents write per-image artifacts
// to _phase2/retag2-out/{image_id}.json as
//   { image_id, hero_prominence, secondary_fixtures_status }
// and --retag2-merge folds them into the source sidecars' tags.

const RETAG2_CHUNKS = path.join(P2, "retag2-chunks");
const RETAG2_OUT = path.join(P2, "retag2-out");
const RETAG2_CHUNK_SIZE = 40;
const PROMINENCE = new Set(["high", "medium", "low"]);
const SECONDARY = new Set(["none", "subordinate", "competing"]);

/** Chunk the curated scenes' source images for the vision re-tag pass. */
async function retag2Prep() {
  await mkdir(RETAG2_OUT, { recursive: true });
  await rm(RETAG2_CHUNKS, { recursive: true, force: true });
  await mkdir(RETAG2_CHUNKS, { recursive: true });

  let curatedIds: string[] = [];
  try {
    curatedIds = (await readdir(CURATED))
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    console.error("[retag2-prep] no curated dir — run phase3-curate first.");
    process.exit(1);
  }

  const idToPath = await scanSourceImages();
  const todo: string[] = [];
  let resumed = 0;
  for (const id of curatedIds) {
    if (existsSync(path.join(RETAG2_OUT, `${id}.json`))) {
      resumed++;
      continue; // resume-aware — already re-tagged
    }
    const p = idToPath.get(id);
    if (p) todo.push(p);
  }
  todo.sort();

  let n = 0;
  for (let i = 0; i < todo.length; i += RETAG2_CHUNK_SIZE) {
    await writeFile(
      path.join(RETAG2_CHUNKS, `chunk-${String(n).padStart(3, "0")}.txt`),
      todo.slice(i, i + RETAG2_CHUNK_SIZE).join("\n") + "\n",
    );
    n++;
  }
  console.log(
    `[retag2-prep] ${curatedIds.length} curated | ${resumed} already done | ` +
      `${todo.length} to re-tag -> ${n} chunk(s) of up to ${RETAG2_CHUNK_SIZE}`,
  );
  if (n === 0) console.log("[retag2-prep] nothing to do — all curated scenes re-tagged.");
}

/** Fold the vision re-tag artifacts into the source sidecars' tags. */
async function retag2Merge() {
  let files: string[] = [];
  try {
    files = (await readdir(RETAG2_OUT)).filter((f) => f.endsWith(".json"));
  } catch {
    /* no out dir yet */
  }
  let merged = 0;
  let discarded = 0;
  const prom: Record<string, number> = {};
  const sec: Record<string, number> = {};

  for (const f of files) {
    const outPath = path.join(RETAG2_OUT, f);
    let art: { image_id?: string; hero_prominence?: string; secondary_fixtures_status?: string };
    try {
      art = JSON.parse(await readFile(outPath, "utf8"));
    } catch {
      await rm(outPath, { force: true });
      discarded++;
      console.warn(`  discard ${f}: invalid JSON`);
      continue;
    }
    if (
      !PROMINENCE.has(art.hero_prominence ?? "") ||
      !SECONDARY.has(art.secondary_fixtures_status ?? "")
    ) {
      await rm(outPath, { force: true });
      discarded++;
      console.warn(`  discard ${f}: invalid tag values`);
      continue;
    }
    const id = art.image_id || f.replace(/\.json$/, "");
    const sidecar = path.join(SOURCES, brandOf(id), `${id}.json`);
    let meta: { tags?: Record<string, unknown> };
    try {
      meta = JSON.parse(await readFile(sidecar, "utf8"));
    } catch {
      console.warn(`  skip ${id}: sidecar not found`);
      continue;
    }
    if (!meta.tags) {
      console.warn(`  skip ${id}: sidecar has no tags`);
      continue;
    }
    meta.tags.hero_prominence = art.hero_prominence;
    meta.tags.secondary_fixtures_status = art.secondary_fixtures_status;
    await writeFile(sidecar, JSON.stringify(meta, null, 2));
    merged++;
    prom[art.hero_prominence!] = (prom[art.hero_prominence!] ?? 0) + 1;
    sec[art.secondary_fixtures_status!] = (sec[art.secondary_fixtures_status!] ?? 0) + 1;
  }

  console.log(`\n[retag2-merge] merged ${merged} | discarded invalid artifacts ${discarded}`);
  console.log(`[retag2-merge] hero_prominence:`, JSON.stringify(prom));
  console.log(`[retag2-merge] secondary_fixtures_status:`, JSON.stringify(sec));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--prep")) {
    const redoArg = args.find((a) => a.startsWith("--redo="));
    await prep(redoArg ? redoArg.split("=")[1] : null);
  } else if (args.includes("--merge")) {
    await merge();
  } else if (args.includes("--qa")) {
    await qa();
  } else if (args.includes("--retag")) {
    await retag();
  } else if (args.includes("--scrub-merge")) {
    await scrubMerge();
  } else if (args.includes("--retag2-prep")) {
    await retag2Prep();
  } else if (args.includes("--retag2-merge")) {
    await retag2Merge();
  } else {
    console.error(
      "Usage: tsx scene-library/phase2-batch.ts --prep [--redo=ids.txt] | --merge | --qa | --retag | --scrub-merge | --retag2-prep | --retag2-merge",
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
