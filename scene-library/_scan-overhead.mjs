// Throwaway scan — finds floor/table-hero scene descriptions that contain
// ceiling / overhead lighting-effect language (ADDITION 3 cleanup target).
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const SOURCES = path.resolve("scene-library/sources");
const BRANDS = ["dazuma", "vakker"];
const CLOSING = "A lighting fixture matching the product reference image is installed naturally";

const LIGHT = "glow|glows|glowing|light|lights|lit|illuminat[a-z]*|wash|washes|washing|lumin[a-z]*|radian[a-z]*|bathe[a-z]*|spill[a-z]*";
const OVERHEAD = new RegExp(
  `\\boverhead\\b|\\bfrom above\\b|ceiling[^.]{0,70}\\b(?:${LIGHT})\\b|\\b(?:${LIGHT})\\b[^.]{0,70}\\bceiling\\b`,
  "i",
);

let floorTable = 0;
const flagged = [];
for (const b of BRANDS) {
  const dir = path.join(SOURCES, b);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const m = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    if (typeof m.description !== "string" || !m.tags) continue;
    const pos = m.tags.source_hero_position;
    if (pos !== "floor" && pos !== "table") continue;
    floorTable++;
    let body = m.description;
    const idx = body.indexOf(CLOSING);
    if (idx >= 0) body = body.slice(0, idx);
    if (OVERHEAD.test(body)) flagged.push(m.image_id);
  }
}

mkdirSync(path.resolve("scene-library/_phase2"), { recursive: true });
writeFileSync(
  path.resolve("scene-library/_phase2/overhead-flagged.txt"),
  flagged.join("\n") + (flagged.length ? "\n" : ""),
);
console.log(`floor/table-hero scenes: ${floorTable}`);
console.log(`flagged (overhead-lighting language): ${flagged.length}`);
