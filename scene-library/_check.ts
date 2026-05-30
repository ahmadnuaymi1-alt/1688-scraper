/**
 * Scene-library QA utility — scans completed descriptions for fixture-object
 * language (Phase 3 RULE 5) and missing camera-angle language (RULE 4).
 * Reads only the `description` body, with the mandated closing sentence
 * stripped (it legitimately contains "fixture").
 *
 *   npx tsx scene-library/_check.ts
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("scene-library");
const CLOSING =
  "A lighting fixture matching the product reference image is installed naturally";
const FIXTURE_WORDS = [
  "chandelier",
  "pendant",
  "sconce",
  "lampshade",
  "bulb",
  "canopy",
  " lamp",
  "light fixture",
];
const ANGLE_RE =
  /camera|eye[- ]level|lens|composition|three-quarter|looking down|looking up|elevated|wide-angle|telephoto/;

async function main() {
  let total = 0;
  let fixtureLeaks = 0;
  let angleMissing = 0;
  const issues: string[] = [];

  for (const brand of ["dazuma", "vakker"]) {
    const dir = path.join(ROOT, "sources", brand);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const meta = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      if (typeof meta.description !== "string" || !meta.description.trim()) continue;
      total++;

      let body: string = meta.description;
      const idx = body.indexOf(CLOSING);
      if (idx >= 0) body = body.slice(0, idx);
      const lower = body.toLowerCase();

      const hits = FIXTURE_WORDS.filter((w) => lower.includes(w));
      const hasAngle = ANGLE_RE.test(lower);
      const endsRight = (meta.description as string).trim().endsWith("design details.");

      if (hits.length || !hasAngle || !endsRight) {
        if (hits.length) fixtureLeaks++;
        if (!hasAngle) angleMissing++;
        issues.push(
          `  ${meta.image_id}: ${hits.length ? `fixture-words[${hits.join(", ")}]` : ""}` +
            `${!hasAngle ? " NO-ANGLE" : ""}${!endsRight ? " BAD-CLOSING" : ""}`,
        );
      }
    }
  }

  console.log(`checked ${total} described scenes`);
  console.log(`  fixture-language leaks: ${fixtureLeaks}`);
  console.log(`  missing camera angle:   ${angleMissing}`);
  console.log(`  clean:                  ${total - issues.length}`);
  if (issues.length) {
    console.log("issues:");
    for (const i of issues) console.log(i);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
