/**
 * One-off: author GENERAL editorial lifestyle scene-overrides for the jewellery
 * box children. The lifestyle-scene-designer is hard-coded for lighting, so we
 * hand-author scene-overrides/<childId>.json (used verbatim by the image
 * creator). Scenes are reference-image-only (NO embedded product description),
 * single-unit, medium-density lived-in interiors, no people, no alcohol.
 *
 *   npx tsx scripts/_write-jewelry-scenes.ts [--only <cid>]
 */
import fs from "node:fs";
import path from "node:path";

// child id -> { variant count, size label }
const CHILDREN: Record<string, { n: number; label: string }> = {
  cmpxx12260001w2yspsqfr94i: { n: 1, label: "2-Layer" },
  cmpxx130y000hw2ys0d5ikvsb: { n: 8, label: "4-Layer" },
  cmpxx161q001pw2ysta9lvk0k: { n: 5, label: "5-Layer" },
  cmpxx1854002lw2ys7vdeln6v: { n: 4, label: "6-Layer" },
  cmpxx19xo003dw2ysoykzsyhg: { n: 1, label: "7-Layer" },
  cmpxx1auc003tw2ysfupa6ih9: { n: 1, label: "10-Layer" },
};

// Reference-image-only fidelity anchor appended to every scene. Generic noun
// only ("the wooden box") — no colour/finish/layer description (the reference
// image carries identity; describing it makes nano_banana_2 average signals).
const ANCHOR =
  "Render the wooden box exactly as shown in the reference image — preserve its exact proportions, wood tone, finish, hardware, every drawer/tray/compartment and interior detail, and its open-or-closed state; do not restyle, resize, recolour, re-open, re-close, or alter it in any way. It is the clear focal point, in sharp focus, occupying a confident share of the frame. Photorealistic editorial interior photograph, natural light, true-to-life materials, no people, no text, no watermark.";

// Five general editorial interiors. Medium density, real colour, lived-in, with
// one or two concrete named imperfections each to defeat the AI-perfect look.
const SCENES: Array<{ slug: string; mode: "homey" | "minimalist"; body: string }> = [
  {
    slug: "bedroom-dresser-morning",
    mode: "homey",
    body:
      "Editorial interior photograph on a 50mm lens, square 1:1, shot at tabletop eye-level. The wooden box rests on the warm walnut top of a bedroom dresser beside a window veiled by sheer oatmeal linen, soft diffused morning light raking from the left. Styling around it (kept lower and secondary): a short stack of two cloth-bound art books with a brass bookmark, a small matte-stoneware vase holding a few stems of eucalyptus, a softly tilted brass-framed photo. The linen dresser runner has natural creases and one folded-back corner. Imperfections: a faint bloom of dust along the dresser's front edge, a single dropped eucalyptus leaf beside the vase. Palette: warm walnut, oatmeal linen, sage green, aged brass.",
  },
  {
    slug: "entry-console-daylight",
    mode: "homey",
    body:
      "Editorial interior photograph on a 35mm lens, square 1:1, slightly off-centre thirds composition. The wooden box sits on a slim oak console table in a sunlit entryway against a soft clay-plaster wall. Secondary styling: a woven seagrass tray holding keys and a folded pair of reading glasses, a round ceramic bowl, a trailing pothos in an earthenware pot whose leaves spill toward the box, a chunky knit scarf draped over one end of the console. Warm late-afternoon sun throws a long soft shadow across the wall. Imperfections: a small scuff on the white baseboard, one pothos leaf curling at its tip. Palette: clay plaster, honey oak, deep green, cream, terracotta.",
  },
  {
    slug: "vanity-soft-mirror",
    mode: "homey",
    body:
      "Editorial interior photograph on a 50mm lens, square 1:1, at tabletop eye-level. The wooden box sits on a cream-painted dressing table, a round wall mirror softly out of focus behind it catching gentle window light. Secondary styling: a small stoneware ring dish, a linen-bound notebook with a pen laid diagonally across it, a single dried garden rose in a slender bud vase, a folded muslin cloth. Soft diffused daylight from frame-left, calm and warm. Imperfections: a faint water ring on the painted top near the dish, the notebook's cover slightly lifted at one corner. Palette: warm cream, pale dusty rose, natural linen, soft brass. Tasteful and restrained — not a cluttered jewellery counter.",
  },
  {
    slug: "wardrobe-oak-shelf",
    mode: "minimalist",
    body:
      "Editorial interior photograph on a 50mm lens, square 1:1, composed straight-on. The wooden box rests on a smooth white-oak open shelf in a walk-in wardrobe, warm directional light skimming from the right. Secondary styling: a neat stack of folded cashmere knits in muted oatmeal, taupe and soft grey beside it, a small woven storage basket on the shelf below, a folded leather belt coiled neatly. Calm, uncluttered, generous negative space. Imperfections: the top knit slightly askew with one soft fold out of line, a faint grain knot in the oak shelf. Palette: white oak, oatmeal, taupe, soft grey, tan leather.",
  },
  {
    slug: "living-sideboard-dusk",
    mode: "homey",
    body:
      "Editorial interior photograph on a 35mm lens, square 1:1, at tabletop eye-level. The wooden box sits on a mid-century walnut sideboard in a warm living room at dusk, a ceramic table lamp glowing soft warm 2700K to one side casting a gentle pool of light over the box. Secondary styling: an open hardcover laid face-down, a low ceramic dish holding three smooth river stones, a small trailing plant, a linen curtain diffusing the blue-hour light behind. Cosy, lived-in, medium density. Imperfections: a ceramic mug leaving a faint ring on a cork coaster, one curtain pleat bunched slightly. Palette: walnut brown, warm amber lamplight, cream, deep green, dusk blue.",
  },
];

const onlyArg = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : null;
})();

for (const [cid, info] of Object.entries(CHILDREN)) {
  if (onlyArg && cid !== onlyArg) continue;
  const scenes = SCENES.map((s, i) => ({
    slug: s.slug,
    mode: s.mode,
    variantSlot: (i % info.n) + 1, // rotate across this child's variants
    strategy: "single",
    prompt: `${s.body} ${ANCHOR}`,
  }));
  const doc = {
    productId: cid,
    productTitle: `Vintage Solid Wood Jewellery Box — ${info.label}`,
    authoredBy:
      "one-off general editorial lifestyle scenes (non-lighting). Reference-image-only anchor; single-unit; medium-density lived-in interiors; no people/alcohol. Split child of deleted parent cmpxvghau000hw260fnktskfz.",
    authoredAt: "2026-06-03",
    category: "indoor",
    scenes,
  };
  const out = path.resolve(process.cwd(), `scene-overrides/${cid}.json`);
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`wrote ${out}  (${scenes.length} scenes, variantSlots ${scenes.map((s) => s.variantSlot).join(",")})`);
}
