export const meta = {
  name: 'jewelry-lifestyle-scene-authoring',
  description: 'Research 2 jewelry lifestyle categories + author 6 reference-anchored editorial scene-overrides for each of 17 jewelry products (boxes, bolo ties, pendant necklaces)',
  phases: [
    { title: 'Research', detail: 'recipes for pendant-necklace + bolo-tie no-person lifestyle photography' },
    { title: 'Author', detail: 'one agent per product → 6 scenes (3 minimalist + 3 homey)' },
  ],
};

// ---- Shared building blocks --------------------------------------------------

const REALISM = `
ANTI-AI PHOTOREALISM (bake into every prompt, woven naturally — never as a checklist):
- Editorial publication context: frame each scene as a real photograph shot for a named outlet (e.g. Kinfolk, Cereal, T Magazine, a Toast or Net-a-Porter catalogue, a Remodelista feature). Name the publication-style.
- Concrete imperfection mandate: name 2-3 SPECIFIC real-world imperfections per scene (a faint smudge on glass, a single dust mote in a sunbeam, a slightly dog-eared page, a hairline scratch in old wood, a stray linen thread, uneven hand-applied patina, a soft crease in leather, a water ring ghost on stone). Imperfections must be plausible for that surface.
- Reject cinematic AI balance: deliberately OFF-CENTER or rule-of-thirds composition, asymmetric prop placement, one element cropped at the frame edge. Avoid the dead-center, perfectly-symmetric, glossy-render look.
- Zero color cast: neutral white balance, NO orange/teal cinematic grade, NO uniform warm filter. Colors true to life.
- Photographic texture: real lens character — shallow depth of field with a believable focal plane, gentle natural grain, micro-contrast, soft natural falloff. Not clinical, not over-sharpened.
- Natural light only: real window daylight / overcast softbox-like sky / golden raking side light — name the direction and time of day. These are NOT lighting products, so NEVER mention a fixture being "on" or color temperatures like 2700K.`;

const HARD_RULES = `
HARD RULES (non-negotiable):
- Output EXACTLY 6 scenes. The FIRST 3 are MINIMALIST mode, the LAST 3 are HOMEY mode.
- MINIMALIST (scenes 1-3): gallery-presented, the product fills 28-38% of frame, 35-50mm lens, LOW density (1-3 objects total on the surface), ONE deliberate accent color, max 1 pattern, calm and tight. The product is the clear hero.
- HOMEY (scenes 4-6): lived-in and layered, product fills 18-28% of frame (wider, the room reads too), 35mm lens, MID density (3-5 considered objects), and you MUST apply the PRODUCT-COLOR-ECHO rule: the room echoes the product's TWO strongest colors (its metal/material finish + its dominant accent/stone/textile color, inferred from the product context below) in at least 2 OTHER elements each. Mix >=2 wood tones, layer textiles, include living plant matter (foraged branches / potted herb / fresh-cut stems, never florist-tight), and one "just-here" human-trace cue (an open book face-down, a half-burned candle, a folded cloth, reading glasses on a tray — but NO actual person).
- REFERENCE-IMAGE-ONLY ANCHOR: the real product is supplied to the image model as an attached reference photo. Your prompt MUST NOT describe the product's own appearance (do NOT name its color, shape, stones, finish, or compartments). Refer to it ONLY generically as "{{ANCHOR_NOUN}}" and end every prompt with a fidelity line like: "Render {{ANCHOR_NOUN}} exactly as in the attached reference image — preserve its exact shape, proportions, colors, materials and details; do not redesign it." The product context below is for YOUR set-design reasoning ONLY (palette/echo/state) — never copy it into the prompt text.
- Each of the 6 scenes uses a DISTINCT environment, a DISTINCT camera angle (vary across: dead-front eye-level, slightly-high looking-down 3/4, top-down flat-lay, low hero 3/4, tight macro-ish detail, pure profile), and a DISTINCT accent palette. No two scenes feel like the same set.
- ANTI-TROPES (every scene): NO humans/faces/hands/body parts, NO pets/kids/toys, NO portraits-of-people or figurative people-art, NO alcohol of any kind, NO casual electronics (phones/laptops/cables), NO food in preparation, NO Chinese characters anywhere, NO 2010s tropes (chevron, all-grey, edison-cage). Keep the product the focal subject — never a distant background prop.
- FORMAT: line 1 is a bracketed tag-block: [room: X | surface: Y | display: Z | accent: W | camera: ANGLE | influence: PUBLICATION/DESIGNER]. Then a single 140-200 word descriptive paragraph. The paragraph must be fully self-contained.`;

// Condensed jewellery-box cornucopia recipe (from memory/lifestyle-cat-jewellery-box.md)
const BOX_RECIPE = `
JEWELLERY-BOX RECIPE (guide, do not copy verbatim):
- Functionality (depict ONLY what THIS box's context clearly implies — never invent a state): closed/gift-ready; lid open; a drawer slid open; a tray lifted out; a glass or transparent lid showing contents through it; watch boxes show watch slots. Show a MIX of states across the 6 and vary what sits inside/around. If the context says glass lid / transparent window -> a closed-but-contents-visible shot is great. If it says drawers / multi-layer -> one drawer ajar. If lockable -> a small brass key as a prop is plausible.
- Shot types this category expects: 3/4 hero; a TOP-DOWN FLAT-LAY showing the tray/compartment layout with a few pieces of jewellery; straight-on front; and detail framing. Include at least one flat-lay among the 6.
- Environments: bedroom dresser / vanity / dressing table; entry console; open wardrobe shelf; living-room sideboard; a soft mirror behind. Surfaces that flatter the box: linen runner, warm marble, raw oak, a stone tray.
- Styling: <=3 restrained props (eucalyptus/dried stems, stoneware dish, art books, folded linen, a few loose pieces of jewellery). Medium density, warm, lived-in.`;

// Harness may deliver `args` as a JSON string or an already-parsed array.
const PRODUCTS = Array.isArray(args)
  ? args
  : (typeof args === 'string' && args.trim() ? JSON.parse(args) : []);

function anchorNoun(category) {
  if (category === 'box') return 'the jewelry box';
  if (category === 'bolo') return 'the bolo tie';
  return 'the pendant necklace';
}

function authorPrompt(p, recipeText) {
  const noun = anchorNoun(p.category);
  const hard = HARD_RULES.replace(/\{\{ANCHOR_NOUN\}\}/g, noun);
  const catGuidance = p.category === 'box'
    ? `This is a JEWELRY BOX. Vary the functional state truthfully across the 6 scenes and include one top-down flat-lay. Do NOT depict a person.`
    : `This is WORN NECK JEWELRY shown WITHOUT any person. Across the 6 scenes VARY the no-person display method (a faceless matte ceramic/linen neck-form or bust, a brass T-bar or ring jewelry stand, a flat-lay on linen/marble/leather/velvet tray, draped over stacked books / a smooth stone / a piece of driftwood or a branch, coiled in a shallow dish, or hung on a simple peg/hook). The piece must read as the hero even when small — frame tight enough.`;

  return `You are an editorial still-life photographer and prop stylist authoring 6 image-generation scene prompts for a luxury jewelry catalogue. The images are made by Nano Banana Pro from a SCENE prompt + an attached REFERENCE photo of the real product.

PRODUCT CONTEXT (for your set-design reasoning ONLY — never copy into the prompt; the reference image carries the actual look):
- Category: ${p.category}
- Title: ${p.title}
- Key attributes: ${p.keySpecs || '(see title)'}
- Variant colors/finishes: ${p.colors || '(see title)'}
- Infer the product's TWO strongest colors (metal/material finish + dominant accent/stone color) for the homey color-echo rule.

${catGuidance}

CATEGORY RECIPE (guidance to spark variety — adapt, do not copy):
${recipeText}
${hard}
${REALISM}

Produce 6 unique, richly-specific scenes (3 minimalist then 3 homey). Make the environments genuinely different from each other (different rooms, surfaces, times of day, display methods, accent palettes). Each prompt 140-200 words plus its tag-block line. Return them via the structured output tool.`;
}

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['displayMethods', 'environments', 'cameraAngles', 'props', 'realismCues', 'colorEchoGuidance', 'notes'],
  properties: {
    displayMethods: { type: 'array', items: { type: 'string' } },
    environments: { type: 'array', items: { type: 'string' } },
    cameraAngles: { type: 'array', items: { type: 'string' } },
    props: { type: 'array', items: { type: 'string' } },
    realismCues: { type: 'array', items: { type: 'string' } },
    colorEchoGuidance: { type: 'string' },
    notes: { type: 'string' },
  },
};

const SCENES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      minItems: 6,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'mode', 'prompt'],
        properties: {
          slug: { type: 'string' },
          mode: { type: 'string', enum: ['minimalist', 'homey'] },
          prompt: { type: 'string' },
        },
      },
    },
  },
};

// ---- Phase 1: research the two new categories --------------------------------

phase('Research');

const PENDANT_RESEARCH = `Research how delicate PENDANT NECKLACES and chain necklaces (turquoise/crystal/leather-cord/geometric-alloy pendants; unisex artistic, vintage and bohemian styles) are photographed for PREMIUM e-commerce and editorial lifestyle WITHOUT any human model (no people, hands, or body parts). Give concrete, specific guidance for an image-prompt author. Cover: (1) no-person DISPLAY METHODS that read as editorial rather than clinical (faceless matte neck-forms/busts, brass T-bar & ring stands, marble/linen/velvet flat-lay, draped over stacked books / smooth stone / driftwood / a branch, coiled in a shallow ceramic dish, hung on a brass peg); (2) ENVIRONMENTS (vanity, dresser, styling table, gallery plinth, sunlit windowsill, leather valet tray, artisan studio bench); (3) CAMERA ANGLES and how prominent MACRO/detail close-ups are for this category; (4) PROPS that flatter small metal+stone jewelry without competing; (5) REALISM cues specific to shiny small metal (reflections, soft shadow, dust); (6) COLOR-ECHO guidance — how a surface/room can repeat the metal finish + stone color. Return a structured recipe.`;

const BOLO_RESEARCH = `Research how BOLO TIES / western neckwear (a long ~39in leather or braided cord with a decorative cast-metal slide and metal tips; western, southwestern, ranch-luxe, vintage and unisex styles) are photographed for PREMIUM e-commerce and editorial lifestyle WITHOUT any human model (no people, hands, necks, or body parts). Give concrete, specific guidance for an image-prompt author. Cover: (1) no-person DISPLAY METHODS (coiled on worn leather or suede, the slide laid flat with the cord arranged in a relaxed S, draped over a wooden peg / a smooth antler / the brim of a felt hat resting on a surface, on a faceless neck-form, flat-lay on raw oak or stone, hung on a forged hook); (2) ENVIRONMENTS that feel elevated-western not kitsch (rustic-luxe console, leather valet, reclaimed-wood workshop bench, ranch dresser, travertine/sandstone surface, a sunlit adobe windowsill); (3) CAMERA ANGLES + role of macro detail on the slide/tips; (4) western-luxe PROPS (worn leather, raw turquoise chunk, kraft, denim, dried desert botanicals, aged brass) used sparingly; (5) REALISM cues; (6) COLOR-ECHO guidance for metal-tone + cord/leather color. Keep it editorial and refined, never costume-y. Return a structured recipe.`;

const [pendantRecipe, boloRecipe] = await parallel([
  () => agent(PENDANT_RESEARCH, { schema: RECIPE_SCHEMA, phase: 'Research', label: 'research:pendant-necklace' }),
  () => agent(BOLO_RESEARCH, { schema: RECIPE_SCHEMA, phase: 'Research', label: 'research:bolo-tie' }),
]);

log(`Research done — pendant recipe (${pendantRecipe.displayMethods.length} display methods), bolo recipe (${boloRecipe.displayMethods.length} display methods)`);

// ---- Phase 2: author 6 scenes per product ------------------------------------

phase('Author');

const recipeFor = (cat) =>
  cat === 'bolo' ? JSON.stringify(boloRecipe, null, 1)
  : cat === 'pendant' ? JSON.stringify(pendantRecipe, null, 1)
  : BOX_RECIPE;

const authored = await parallel(
  PRODUCTS.map((p) => () =>
    agent(authorPrompt(p, recipeFor(p.category)), {
      schema: SCENES_SCHEMA,
      phase: 'Author',
      label: `author:${p.category}:${p.title.slice(0, 26)}`,
    }).then((r) => ({ id: p.id, category: p.category, title: p.title, poolSize: p.poolSize, scenes: r.scenes }))
      .catch(() => null)
  )
);

const ok = authored.filter(Boolean);
log(`Authored scenes for ${ok.length}/${PRODUCTS.length} products`);

return { pendantRecipe, boloRecipe, authored: ok };
