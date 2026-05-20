/**
 * v24 — Higgsfield Playwright integration test.
 *
 * Same product as v23 (walnut + swirled-wave entry semi-flush, p1).
 * Drives Higgsfield's web UI via Playwright using the persistent-context
 * wrapper at scripts/_higgsfield-lifestyle.ts.
 *
 * First run: opens Chromium HEADED → log in via Gmail → script captures session.
 * Subsequent runs: HEADLESS, ~3 min for 4 images.
 *
 * Usage:
 *   npx tsx scripts/probe-generate-scenes-v24-higgsfield.ts
 *   npx tsx scripts/probe-generate-scenes-v24-higgsfield.ts --headed   (forces headed)
 *   npx tsx scripts/probe-generate-scenes-v24-higgsfield.ts --keep-open (don't close browser at end)
 */
import path from "node:path";
import os from "node:os";
import { runHiggsfieldBatch } from "./_higgsfield-lifestyle";

const REF = path.join(os.tmpdir(), "scene", "p1", "p1_1.jpg");
const OUT_DIR = path.join(os.tmpdir(), "scene", "output");

// v23-style identity-vs-view GUARDRAILS — locks the product's identity while
// authorizing the model to render from any camera angle.
const GUARDRAILS = `PRODUCT IDENTITY (must match reference image):
The product is a small ceiling-mounted semi-flush light. A round SOLID WALNUT WOOD CANOPY disc is mounted flush against the ceiling. Suspended just below the walnut canopy on a short slender stem is an OPAL-WHITE GLASS DOME SHADE with a soft swirled wave pattern around its curved surface — broad continuous waves that wind around the dome as they descend. The bottom edge of the dome is scalloped into a soft petal skirt-hem with 6 to 7 rounded petal lobes around the rim. Materials: matte walnut wood canopy + matte opal-white shade. When switched on, warm 2700-3000K light glows softly through the opal material.

The product's MATERIALS, COLORS, SILHOUETTE, PROPORTIONS, and DISTINCTIVE FEATURES must match the reference image exactly. The product's VIEWING ANGLE, ORIENTATION, AND ROTATION relative to the camera MUST adapt to the camera position the scene calls for. Do NOT copy the reference image's viewing angle of the product. Treat the reference image as a guide to the product's IDENTITY, not as a template for the product's pose.

ONE SINGLE photograph. NO HUMANS, NO PETS. NO alcohol, wine, cocktails, bar items. ZERO Chinese / Asian characters in frame.

`;

// Simple vibe-based prompts. No long GUARDRAILS — Higgsfield's UI handles
// fidelity better with brief direction. Each prompt asks for a different
// camera angle so the 4 outputs vary in how the product is shown.
const PROMPTS = [
  {
    slug: "v24_lifestyle_low_up_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: low, looking up at the fixture.",
  },
  {
    slug: "v24_lifestyle_side_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: side-3/4 view of the fixture.",
  },
  {
    slug: "v24_lifestyle_elevated_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: elevated, looking down at the room with the fixture visible.",
  },
  {
    slug: "v24_lifestyle_front_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: conventional eye-level front-facing.",
  },
];

async function main() {
  const args = process.argv.slice(2);
  const forceHeaded = args.includes("--headed");
  const keepOpen = args.includes("--keep-open");

  console.log(`Reference: ${REF}`);
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Prompts: ${PROMPTS.length}`);

  const t0 = Date.now();
  const { ok, fail } = await runHiggsfieldBatch({
    referenceImage: REF,
    prompts: PROMPTS,
    outDir: OUT_DIR,
    forceHeaded,
    keepOpen,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone. ${ok}/${PROMPTS.length} succeeded, ${fail} failed. Wall time: ${elapsed}s.`);
  console.log(`Folder: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
