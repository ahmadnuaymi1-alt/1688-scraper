/**
 * Phase 3 — quality filtering. Applies the accept/reject rules to every
 * described sidecar and builds the curated scene library.
 *
 *   npx tsx scene-library/phase3-curate.ts
 *
 * Rules (from the refactor spec):
 *  - ACCEPT only if hero_position_clarity = "clear" AND
 *    secondary_fixtures_status is "none" | "subordinate".
 *  - REJECT competing fixtures, ambiguous hero, description < 100 words,
 *    empty product_category_fit, or no camera-angle language.
 *  - FLAG (exclude pending review) any description still containing a
 *    fixture-object word.
 *
 * Accepted scenes are written to scene-library/curated/{scene_id}.json.
 * Deterministic — no LLM, no network.
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("scene-library");
const SOURCES = path.join(ROOT, "sources");
const CURATED = path.join(ROOT, "curated");
const ARCHIVED = path.join(ROOT, "archived");
const BRANDS = ["dazuma", "vakker"];

const ANGLE_RE =
  /camera|eye[- ]level|lens|composition|three-quarter|looking down|looking up|elevated|wide-angle|telephoto|vantage|vignette/i;
const CLOSING_MARKER =
  "A lighting fixture matching the product reference image is installed naturally";
// Context-aware fixture-object words (Checkpoint-1 finding: "canopy"/"shade"
// are overloaded and excluded; "fixture" lives in the mandated closing line).
const FIXTURE_PATTERNS: RegExp[] = [
  /\bchandeliers?\b/,
  /\bpendants?\b/,
  /\bsconces?\b/,
  /\blamp ?shades?\b/,
  /\blight fixtures?\b/,
  /\bluminaires?\b/,
  /\blamps?\b/,
  /\bbulbs?\b/,
];
const CATEGORIES = [
  "chandelier", "pendant", "flush_mount", "sconce", "table_lamp", "floor_lamp", "outdoor",
];

/** Required source_hero_position per library category (outdoor unconstrained). */
const HERO_POS_REQ: Record<string, string> = {
  chandelier: "ceiling",
  pendant: "ceiling",
  flush_mount: "ceiling",
  sconce: "wall",
  table_lamp: "table",
  floor_lamp: "floor",
};

const bump = (rec: Record<string, number>, key: string) =>
  (rec[key] = (rec[key] ?? 0) + 1);

const sortedEntries = (rec: Record<string, number>) =>
  Object.entries(rec).sort((a, b) => b[1] - a[1]);

async function main() {
  await rm(CURATED, { recursive: true, force: true });
  await mkdir(CURATED, { recursive: true });
  await rm(ARCHIVED, { recursive: true, force: true });
  await mkdir(ARCHIVED, { recursive: true });

  let total = 0;
  let accepted = 0;
  const rejectReasons: Record<string, number> = {};
  const flagged: string[] = [];
  let rejected = 0;
  const byBrand: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byRoom: Record<string, number> = {};
  const byFlavor: Record<string, number> = {};
  const byDensity: Record<string, number> = {};
  const bySourceHero: Record<string, number> = {};
  const byHeroProminence: Record<string, number> = {};
  const catRooms: Record<string, Set<string>> = {};
  const catHeroFit: Record<string, number> = {};
  const catHeroHighFit: Record<string, number> = {};

  for (const brand of BRANDS) {
    const dir = path.join(SOURCES, brand);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    const imageFiles = new Map<string, string>();
    for (const f of files) {
      const m = f.match(/^(.+)\.(jpg|jpeg|png|webp)$/i);
      if (m) imageFiles.set(m[1], f);
    }

    for (const f of files) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      let meta: any;
      try {
        meta = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      } catch {
        continue;
      }
      if (typeof meta.description !== "string" || !meta.description.trim()) continue;
      total++;

      const desc: string = meta.description;
      const tags = meta.tags ?? {};
      const reasons: string[] = [];

      // Rule 6 — camera-angle language present.
      if (!ANGLE_RE.test(desc)) reasons.push("no-angle");
      // Rule 4 — length + category fit.
      if (desc.trim().split(/\s+/).filter(Boolean).length < 100) reasons.push("too-short");
      if (!Array.isArray(tags.product_category_fit) || tags.product_category_fit.length === 0)
        reasons.push("no-category-fit");
      // Rule 2 — competing secondary fixtures.
      if (tags.secondary_fixtures_status === "competing") reasons.push("competing-fixtures");
      // Rule 3 / Rule 1 — hero position must be unambiguous.
      if (tags.hero_position_clarity !== "clear") reasons.push("ambiguous-hero");
      // Refinement — the hero must be a real focal subject, not a corner accent.
      if (tags.hero_prominence === "low") reasons.push("low-prominence");

      // Rule 5 — a residual fixture-word leak is also a rejection.
      let body = desc;
      const idx = body.indexOf(CLOSING_MARKER);
      if (idx >= 0) body = body.slice(0, idx);
      if (FIXTURE_PATTERNS.some((re) => re.test(body.toLowerCase()))) {
        reasons.push("fixture-leak");
        flagged.push(meta.image_id);
      }

      const imgFile = imageFiles.get(meta.image_id);
      const doc = {
        scene_id: meta.image_id,
        source_brand: meta.source_brand,
        source_image: imgFile
          ? path.posix.join("scene-library", "sources", brand, imgFile)
          : null,
        source_url: meta.source_url,
        description: desc,
        tags,
      };

      // Rejected scenes go to archived/ (kept for possible future relaxation).
      if (reasons.length) {
        rejected++;
        for (const r of reasons) bump(rejectReasons, r);
        await writeFile(
          path.join(ARCHIVED, `${meta.image_id}.json`),
          JSON.stringify(doc, null, 2),
        );
        continue;
      }

      // ACCEPTED — write the curated record.
      accepted++;
      await writeFile(
        path.join(CURATED, `${meta.image_id}.json`),
        JSON.stringify(doc, null, 2),
      );

      bump(byBrand, meta.source_brand);
      bump(byDensity, tags.density ?? "?");
      bump(byRoom, tags.room_type ?? "?");
      bump(byFlavor, tags.aesthetic_flavor ?? "?");
      bump(bySourceHero, tags.source_hero_position ?? "?");
      bump(byHeroProminence, tags.hero_prominence ?? "?");
      for (const c of tags.product_category_fit as string[]) {
        bump(byCategory, c);
        (catRooms[c] ??= new Set()).add(tags.room_type);
        const reqPos = HERO_POS_REQ[c];
        if (!reqPos || tags.source_hero_position === reqPos) {
          bump(catHeroFit, c);
          if (tags.hero_prominence === "high") bump(catHeroHighFit, c);
        }
      }
    }
  }

  // ── Checkpoint 2 report ──────────────────────────────────────────────
  const line = "─".repeat(60);
  console.log(`\n${line}\nPHASE 3 — CURATION REPORT (Checkpoint 2)\n${line}`);
  console.log(`described scenes:  ${total}`);
  console.log(`  ACCEPTED:        ${accepted}`);
  console.log(`  rejected:        ${rejected}`);
  console.log(`  flagged (review):${flagged.length}`);

  console.log(`\nreject reasons (a scene may have several):`);
  for (const [r, n] of sortedEntries(rejectReasons)) console.log(`  ${r.padEnd(20)} ${n}`);

  console.log(`\naccepted by source brand:`);
  for (const [b, n] of sortedEntries(byBrand)) {
    console.log(`  ${b.padEnd(20)} ${n}  (${((n / accepted) * 100).toFixed(0)}%)`);
  }

  console.log(`\naccepted by source_hero_position:`);
  for (const [h, n] of sortedEntries(bySourceHero)) console.log(`  ${h.padEnd(10)} ${n}`);

  console.log(`\naccepted by hero_prominence:`);
  for (const [h, n] of sortedEntries(byHeroProminence)) console.log(`  ${h.padEnd(10)} ${n}`);

  console.log(
    `\nper product category — scenes usable AFTER the hard hero-position filter` +
      `\n(high-prominence is the count that matters: the matcher allows at most 1 medium per 6):`,
  );
  for (const c of CATEGORIES) {
    const total = byCategory[c] ?? 0;
    const heroFit = catHeroFit[c] ?? 0;
    const highFit = catHeroHighFit[c] ?? 0;
    const flag = highFit < 30 ? "  <-- THIN (<30 high-prominence)" : "";
    console.log(
      `  ${c.padEnd(14)} ${String(highFit).padStart(4)} high / ` +
        `${String(heroFit).padStart(4)} hero-matched / ${total} category-fit${flag}`,
    );
  }

  console.log(`\naccepted by room_type:`);
  for (const [r, n] of sortedEntries(byRoom)) console.log(`  ${r.padEnd(16)} ${n}`);

  console.log(`\naccepted by aesthetic_flavor:`);
  for (const [a, n] of sortedEntries(byFlavor)) console.log(`  ${a.padEnd(24)} ${n}`);

  console.log(`\naccepted by density:`);
  for (const [d, n] of sortedEntries(byDensity)) console.log(`  ${d.padEnd(8)} ${n}`);

  const report = {
    generated: new Date().toISOString(),
    described: total,
    accepted,
    rejected,
    flagged: flagged.length,
    flagged_ids: flagged,
    reject_reasons: rejectReasons,
    by_brand: byBrand,
    by_category: Object.fromEntries(
      CATEGORIES.map((c) => [c, { scenes: byCategory[c] ?? 0, room_types: catRooms[c]?.size ?? 0 }]),
    ),
    by_room: byRoom,
    by_flavor: byFlavor,
    by_density: byDensity,
    by_source_hero: bySourceHero,
    by_hero_prominence: byHeroProminence,
    cat_hero_compatible: Object.fromEntries(CATEGORIES.map((c) => [c, catHeroFit[c] ?? 0])),
    cat_hero_high_compatible: Object.fromEntries(
      CATEGORIES.map((c) => [c, catHeroHighFit[c] ?? 0]),
    ),
  };
  await writeFile(path.join(ROOT, "_phase3-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${line}\ncurated library -> ${CURATED}\nfull report   -> scene-library/_phase3-report.json\n${line}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
