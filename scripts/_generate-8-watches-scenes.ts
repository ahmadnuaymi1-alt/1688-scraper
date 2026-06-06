/**
 * Generate scene-overrides JSON files for 8 watch products using a fixed
 * scene-template library + a per-product 6-mix selection. Each product gets
 * a distinct combination of 6 templates from the watches cornucopia, so no
 * two products feel like the same template across the store.
 *
 * Output: writes scene-overrides/<productId>.json for each of the 8.
 * Run: `npx tsx scripts/_generate-8-watches-scenes.ts`
 */
import fs from "node:fs";
import path from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// Scene template library — 14 baseline patterns + 4 extras from the watches
// cornucopia. Each template is variant-agnostic and watch-agnostic. The
// dial-text-fidelity rule is softened for lifestyle scale per user feedback.
// ───────────────────────────────────────────────────────────────────────────
const SHARED_TAIL =
  ` Render the watch EXACTLY per the reference image — preserve every component, finish, dial colour, hand and marker style, bezel insert colour and material, bracelet OR leather-strap style and stitching (match the reference exactly), buckle/clasp style, and proportions. Crystal must read fully clear. Dial-text fidelity (softened at lifestyle scale): markers, hand style, sub-dial layout, dial colour and date numeral preserved; brand text may render soft at this small frame scale but must NOT be swapped to a different recognisable brand.` +
  ` Photorealistic editorial product photography. No people, no hands, no arms, no wrist, no food, no drink, no coffee ring, no crumbs, no smoke, no text overlay, no watermark, no alcohol, no Chinese characters.`;

interface Template {
  slug: string;
  mode: "minimalist" | "homey";
  strategy: string;
  anchor: string;
  bodyPrompt: string;
}

const TEMPLATES: Record<string, Template> = {
  A_watchmaker_bench: {
    slug: "watch-watchmaker-bench-brass-tray",
    mode: "minimalist",
    strategy: "nested-in-brass-tray",
    anchor: "a brushed-brass watchmaker's tray on a folded oatmeal microfibre cloth",
    bodyPrompt:
      "Editorial still life on a watchmaker's bench, photographed dead-overhead on an 80mm macro lens in a 1:1 composition, soft cool daylight from frame-upper-left. A brushed brass rectangular watchmaker's tray (about 18 cm wide) sits on a folded oatmeal microfibre cloth on a dark walnut bench. The watch lies inside the tray, bracelet/strap uncoiled in a relaxed S-curve. Outside the upper-right of the tray, slightly out of focus: a single brass watchmaker's loupe lying on its side. Lower-right: brass tweezers crossed at the corner. NO other props. Palette: brushed brass, oatmeal microfibre, dark walnut, the watch's own native colour. Sharp focus on the watch and tray; loupe and tweezers in soft focus. Two named imperfections: a single fibre of microfibre cloth caught at the bracelet clasp, dark patina deepening at the loupe's collar.",
  },
  B_leather_watch_roll: {
    slug: "watch-open-leather-watch-roll-oxblood",
    mode: "minimalist",
    strategy: "nested-in-pillow",
    anchor: "an open oxblood pebbled-leather watch roll with two padded pillows, watch nested into one pillow on its side",
    bodyPrompt:
      "Editorial collector still life, photographed at a slightly-low standing eye level on an 80mm lens in a tight 1:1 composition, soft warm afternoon light raking from frame-upper-right. Surface: a dark walnut shelf corner. Centered: an opened oxblood pebbled-calf watch roll, partially unrolled flat, showing two padded leather pillows. The watch lies nested into the upper pillow on its side, crown facing the camera, bracelet/strap draping loosely down over the lower pillow. The unbuckled leather tie strap of the roll lies relaxed at the lower-right. NO other props. Palette: oxblood and bourbon leather, dark walnut, the watch's own native colour. Sharp focus on the watch and upper pillow. Two named imperfections: darker patina along the edge of the oxblood roll where it folds, one cracked stitch on the lower pillow's piping.",
  },
  C_foxed_ledger: {
    slug: "watch-open-foxed-ledger-fountain-pen",
    mode: "homey",
    strategy: "draped-across-page-spread",
    anchor: "a vintage 1940s accounting ledger open across the gutter, watch lying dial-up over the spine with a capped fountain pen along the right margin",
    bodyPrompt:
      "Editorial archival still life, photographed at a slightly-high looking-down standing height on a 50mm lens, off-center thirds composition, soft warm late-afternoon light from frame-left. Surface: a wide warm walnut desk. Centred: a vintage 1940s cloth-and-board accounting ledger lying open, both pages showing faded handwritten columns in deep blue-black ink (no readable text — abstract cursive shapes only). The watch lies dial-up across the gutter so the spine catches the bracelet/strap, oriented horizontally. Along the right margin of the right page, parallel to the long axis: a slim capped Bordeaux-red fountain pen with a brass clip. At the upper-left corner of the left page: a round brass paperweight, dome up. NO other props. Palette: warm walnut, foxed cream ledger paper, blue-black ink, Bordeaux lacquer, oiled brass, the watch's own native colour. Sharp focus on the watch and the immediate gutter; pen and paperweight in editorial soft focus. Two named imperfections: foxing browning along the page edges, a faint ink-bleed-through ghost on the verso of the right page.",
  },
  D_monograph_stack: {
    slug: "watch-cloth-monograph-stack",
    mode: "minimalist",
    strategy: "lying-on-stack-top",
    anchor: "a stack of three cloth-bound art monographs with a leather bookmark ribbon trailing, watch lying dial-up flat on the top book",
    bodyPrompt:
      "Editorial library still life, photographed at a slightly-high looking-down standing height on a 50mm lens in a centered 1:1 composition, soft cool morning light from frame-upper-left. Surface: a wide pale ash oak shelf. Centered: a neat stack of three cloth-bound art monographs (top ivory linen, middle dusty-rose linen, bottom deep forest linen), each with subtle gilt spine details (no readable text). Stack is about 6 cm tall. The watch lies dial-up flat on the centre of the top monograph, bracelet/strap uncoiled in a diagonal that drapes over the front edge. A slim deep-aubergine leather bookmark ribbon trails out from between the middle and bottom volumes toward the lower-right. NO other props. Palette: pale ash oak, ivory / dusty-rose / forest linen, deep aubergine leather, the watch's own native colour. Sharp focus on the watch and the top cover; lower books in soft focus. Two named imperfections: one slight crease in the ivory linen near the spine, fine dust along the ash surface edge.",
  },
  E_open_notebook: {
    slug: "watch-open-notebook-fountain-pen-paperweight",
    mode: "homey",
    strategy: "lying-on-page-corner",
    anchor: "an open hardcover notebook on a desk, watch lying dial-up at the top corner of a page of fountain-pen handwriting",
    bodyPrompt:
      "Editorial writer's-desk still life, photographed at slightly-above standing eye level on a 50mm lens, off-center thirds composition, soft warm late-afternoon light from frame-left. Surface: a warm walnut writing desk with visible long-grain. Centered slightly off-axis: a large open hardcover notebook in deep navy buckram, both pages visible. The right page shows a single column of fountain-pen handwriting in deep blue-black ink (no readable words — abstract cursive). The watch lies dial-up at the upper-left of that page, bracelet/strap trailing diagonally down across the gutter. Lower-right corner, parallel to the handwriting: an uncapped Bordeaux-red lacquer fountain pen with a gold nib. At the spine: a small round brass paperweight, dome-side up. Far background in soft focus: a brass desk lamp warm-glowing at 2700K. Palette: warm walnut, deep navy buckram, cream paper, blue-black ink, Bordeaux lacquer, oiled brass, warm tungsten, the watch's own native colour. Sharp focus on the watch and immediate page; pen, paperweight, lamp in editorial soft focus. Two named imperfections: a faint blue-black ink-bleed ghost on the verso, a tiny darkened patch on the walnut where the notebook spine has rested for years.",
  },
  F_pocket_square_stack: {
    slug: "watch-linen-pocket-square-stack-profile",
    mode: "minimalist",
    strategy: "lying-on-fold",
    anchor: "a small stack of three folded linen pocket squares on a warm oak surface, watch lying on its side along the top fold",
    bodyPrompt:
      "Editorial still life, photographed at low slightly-above-surface eye level on an 80mm lens in a tight 1:1 composition, soft cool morning light from frame-upper-left through an unseen north-facing window. Surface: warm honey-oak desk with visible quarter-sawn grain. Centered: a small disciplined stack of three folded linen pocket squares (top cream, middle bone, bottom warm taupe), slightly rumpled at edges, about 4 cm tall. The watch lies on its side along the top fold of the cream square, crown in profile, bracelet/strap uncoiled in a relaxed S that drapes over the front edge of the stack and onto the oak. NO other props — discipline is the point. Palette: warm honey oak, cream / bone / taupe linen, the watch's own native colour. Sharp focus on the watch and the front fold of the cream square; deeper stack falls into soft focus. Two named imperfections: one wrinkle across the cream square parallel to the bracelet, fine dust along the oak quarter-sawn grain at the right edge.",
  },
  G_cigar_box: {
    slug: "watch-vintage-cigar-box-silk-lining",
    mode: "homey",
    strategy: "nested-in-lined-box",
    anchor: "a vintage hardwood cigar box with lid open showing faded silk lining, watch lying inside on the lining",
    bodyPrompt:
      "Editorial collector still life, photographed at a slightly-high looking-down standing height on a 50mm lens in a tight 1:1 composition, soft warm window light from frame-left. Surface: a dark walnut writing desk. Centred: an aged Spanish-cedar hardwood cigar box (about 18 cm wide), lid hinged fully open and resting back. The inside of the lid shows faded oyster-cream silk lining with a sepia-toned crest illustration (no readable text). Inside the box base: the watch lies dial-up on the silk lining, slightly off-centre, bracelet/strap uncoiled into a soft S. Underneath the watch, partially peeking out: the corners of two foxed sepia postcards and one buff business card (no readable text). NO cigars, NO ash, NO smoke. Palette: warm sepia cedar, oyster-cream silk, foxed cream paper, the watch's own native colour. Sharp focus on the watch and silk lining; postcards and lid label in soft focus. Two named imperfections: one soft pencil mark on the silk lining near a brass hinge, slight age-yellowing where the silk meets the wood frame.",
  },
  H_saddle_leather_mat: {
    slug: "watch-saddle-leather-desk-mat-corner",
    mode: "minimalist",
    strategy: "lying-in-corner-of-mat",
    anchor: "the lower-right corner of a saddle-leather desk mat in deep cognac, watch lying dial-up with a brass key feathering out of frame",
    bodyPrompt:
      "Editorial still life, photographed at slightly-above standing eye level on a 50mm lens, off-center two-thirds composition with the watch at the lower-third intersection, soft warm late-afternoon light from frame-left through an unseen linen curtain. Surface: a fine-grain matte saddle-leather desk mat in deep cognac, edge-stitched in cream waxed thread, filling most of the frame. The watch lies dial-up in the lower-right corner of the mat, bracelet/strap in a slow diagonal toward the upper-left. Companion props in the upper-right quadrant in soft focus: an aged brass key on a small dark leather fob lying parallel to the bracelet, the corner of a manila envelope feathering out of the upper-right edge of frame, a folded tortoiseshell-frame reading-glasses case in the deep background. Palette: deep cognac saddle leather, cream stitch, oiled brass, soft warm window light, the watch's own native colour. Sharp focus on the watch only; companions in editorial soft focus. Two named imperfections: a darkened corner of the mat where a thumb has touched it for years, a barely-visible hairline scratch on the case flank.",
  },
  I_travertine_tray: {
    slug: "watch-honed-travertine-tray-cedar-sprig",
    mode: "minimalist",
    strategy: "nested-in-stone-tray",
    anchor: "a small rectangular honed-travertine tray with a soft beveled lip, watch lying dial-up inside the tray with a single cedar sprig at the edge",
    bodyPrompt:
      "Editorial overhead still life, photographed dead-overhead on a 100mm macro lens at a 1:1 composition, soft daylight raking from frame-upper-right. Surface beneath the tray: a deep matte charcoal felt mat. Centered: a small rectangular honed-travertine stone tray (about 16 cm long, 11 cm wide, soft beveled inner lip about 8 mm tall, warm-cream stone with subtle veining). The watch lies dial-up inside the tray, perfectly nested into the lip on the longer axis, bracelet/strap uncoiled in a relaxed S that follows the inside curve. Upper-right edge of the tray breaks the lip: a single short cedar sprig (no berries, 4 cm long). NO other props. Palette: charcoal felt, warm-cream travertine, soft green cedar, the watch's own native colour. Sharp focus on the watch and tray interior; cedar in soft focus. Two named imperfections: a hairline crack in the travertine along the inner short edge, a single grain of stone dust on the tray surface near the lug.",
  },
  J_travel_valet: {
    slug: "watch-travel-valet-dopp-kit-passport",
    mode: "homey",
    strategy: "lying-half-on-shirt-cuff",
    anchor: "an open leather dopp kit on a wooden hotel-room ledge, watch lying half on a folded ironed shirt cuff with a passport peeking out",
    bodyPrompt:
      "Editorial travel still life, photographed at slightly-high looking-down standing height on a 50mm lens, off-center thirds composition, soft warm morning light from a frame-upper-left window. Surface: a warm walnut hotel-room ledge. Centered slightly off-axis: an aged caramel leather dopp kit sitting open at the back of frame, its brass-buckle flap relaxed forward. In the lower foreground: a folded pale chambray oxford-cloth shirt, the visible button-down cuff and collar fold catching the morning light. The watch lies half on the shirt cuff, half on the wood ledge, dial-up, bracelet/strap diagonal. Just behind the watch: a navy passport with a brass corner clip, slightly worn at the spine, peeking out from under the cuff. NO bathroom visible, NO mirror. Palette: warm walnut, pale chambray blue, oiled caramel leather, navy passport leather, weathered brass, the watch's own native colour. Sharp focus on the watch and shirt cuff; dopp kit and passport in soft focus. Two named imperfections: a single loose thread at the oxford cuff's stitching, a softened corner on the dopp kit's leather flap.",
  },
  K_library_armchair: {
    slug: "watch-library-armchair-arm-open-hardback",
    mode: "homey",
    strategy: "lying-on-armrest",
    anchor: "the quilted leather armrest of a cognac library armchair, watch lying on its side with an open hardback face-down nearby",
    bodyPrompt:
      "Editorial library still life, photographed at standing eye level on a 50mm lens, off-center thirds composition with the watch at the lower-third intersection, soft warm late-afternoon light from frame-right with warm tungsten room glow at 2700K. Surface: the rolled and quilted armrest of a deep cognac Chesterfield-style armchair, quilt diamonds visible, brass tack-trim faintly out of focus along the edge. The watch lies on its side along the centerline of the armrest, dial toward the camera, crown reading 3 o'clock, bracelet/strap relaxed into the quilt depressions. Just behind: an open hardback book held face-down at a small angle (cracked spine visible, no readable text). On top of the closed back: folded tortoiseshell reading glasses. Far background: the curved end of a brass-shaded library lamp catching warm light. Palette: deep cognac quilted leather, dark walnut book cover, tortoiseshell, brushed brass, warm tungsten amber, the watch's own native colour. Sharp focus on the watch only; book, glasses, lamp in soft focus. Two named imperfections: a darkened polished patch on the armrest where a forearm has rested for years, one slight crease across the hardback's exposed page.",
  },
  L_mariner_chart: {
    slug: "watch-mariner-chart-desk-brass-divider",
    mode: "minimalist",
    strategy: "lying-on-chart",
    anchor: "an unrolled vintage nautical chart held flat by a brass divider compass and a glass paperweight, watch lying dial-up on a contour line",
    bodyPrompt:
      "Editorial mariner still life, photographed at a slightly-high looking-down standing height on a 50mm lens in a 1:1 composition, soft cool late-morning light from frame-left. Surface: a wide partially unrolled vintage nautical chart on a dark walnut desk; coastline contour lines, depth soundings, and compass rose visible but no readable text. Holding the chart open: a polished brass divider compass at the upper-left with one leg pinning the paper, and a heavy round glass paperweight at the lower-right. The watch lies dial-up centered on the chart over a contour line, bracelet/strap uncoiled in a slow diagonal toward the lower-right. NO sea spray, NO water, NO sky. Palette: faded cream chart paper, warm walnut, oiled brass, clear glass, the watch's own native colour. Sharp focus on the watch and chart around it; divider and paperweight in gentle soft focus. Two named imperfections: a foxed-edge brown age-spot on the chart's upper-right margin, fine dust along the walnut desk grain at the chart's lower edge.",
  },
  M_architect_parchment: {
    slug: "watch-architect-parchment-roll-wooden-rule",
    mode: "minimalist",
    strategy: "lying-on-vellum",
    anchor: "a partially unrolled vellum architectural drawing on a workshop desk, watch lying dial-up on the paper",
    bodyPrompt:
      "Editorial atelier still life, photographed at slightly-high looking-down standing height on a 50mm lens in a 1:1 composition, soft cool north-facing daylight from frame-upper-left. Surface: a long partially unrolled vellum architectural tracing in warm cream-yellow, showing faint blueprint line work for an elevation drawing (no readable text). The roll's far end curls slightly at upper-right. Holding the vellum flat: a slim ebonised wooden scale ruler running horizontally across the lower third. The watch lies dial-up centred on the vellum, bracelet/strap curving down toward the wooden rule. To the right of the watch, lying parallel to the rule: a stub of a red drafting pencil with a worn graphite tip. NO other props. Palette: warm cream-yellow vellum, faded blueprint blue, ebonised wood, dusty red pencil, the watch's own native colour. Sharp focus on the watch and centre of the vellum; ruler and pencil in soft focus. Two named imperfections: one soft pencil mark trailing diagonally across the vellum near the lug, a single rolled curl at the upper-right corner.",
  },
  N_ceramic_catch_dish: {
    slug: "watch-bedside-ceramic-catch-dish-cufflinks",
    mode: "homey",
    strategy: "coiled-in-dish",
    anchor: "a matte hand-thrown oat-clay catch-dish on a small dark walnut nightstand corner, watch coiled inside with a brass collar stud and single cufflink alongside",
    bodyPrompt:
      "Editorial bedside-valet still life, photographed at slightly-above standing eye level on a 50mm lens in off-center thirds composition, soft warm tungsten room light at 2700K plus a faint cool moonlight edge from frame-upper-right. Surface: the corner of a small dark stained walnut nightstand top, the rounded edge visible at the lower-left. Centered slightly upper-right: a matte hand-thrown ceramic catch-dish in oat-clay tone (about 12 cm across, 2 cm tall, gently irregular rim). The watch is coiled inside the dish on its own bracelet/strap so the case rests dial-up at the centre, strap/bracelet curled around it in a relaxed spiral. Beside the dish on the walnut: a single polished brass collar stud and one lone cufflink (engraved with an abstract crest, no readable text). Behind, in soft focus: one folded silk pocket square in dove-grey draped loosely. Far background mostly out of frame: the warm glow of a small bedside lamp shade. NO bedding, NO mattress, NO bed visible. Palette: dark walnut, matte oat-clay ceramic, polished brass, dove-grey silk, warm tungsten with faint cool edge, the watch's own native colour. Sharp focus on the watch and dish interior; cufflink, collar stud, silk in soft focus. Two named imperfections: one shallow fingerprint on the matte ceramic rim catching the light, fine dust along the rounded walnut edge.",
  },
  O_atelier_brass_workbench: {
    slug: "watch-atelier-brass-workbench-loupe",
    mode: "homey",
    strategy: "lying-on-blotter",
    anchor: "a green-tooled leather workshop blotter, watch lying dial-up beside a brass loupe and a glassine envelope holding a single crystal",
    bodyPrompt:
      "Editorial watchmaker's workshop still life, photographed at slightly-high looking-down standing height on a 50mm lens, off-center thirds composition, soft cool north-facing daylight from frame-upper-left plus a faint warm task-lamp glow clipping into the upper-right edge of frame. Surface: a wide green-tooled leather blotter on a dark walnut bench, gold tooling worn along the visible long edge. The watch lies dial-up centred-left on the blotter, bracelet/strap uncoiled in a slow S toward the lower-left corner. Centre-right, beside the watch: a polished brass jeweller's loupe standing on its own collar. To its right, slightly off-axis: a small glassine envelope lying flat, lightly translucent, with a single watch crystal nestled inside. Lower-right corner: the brushed handle of a spring-bar tool peeking into frame. NO other props. Palette: forest green tooled leather, faded gold tooling, brushed brass, translucent glassine, dark walnut, the watch's own native colour. Sharp focus on the watch and loupe; glassine and spring-bar in soft focus. Two named imperfections: dark patina deepening along the brass loupe's worn collar, one fine scuff in the green tooling near the watch's lug.",
  },
  P_tailors_atelier: {
    slug: "watch-tailors-atelier-wool-bolt-brass-pins",
    mode: "minimalist",
    strategy: "lying-half-on-fabric",
    anchor: "the edge of a folded charcoal worsted-wool bolt on a tailor's bench, watch lying half on the wool with brass pins clustered nearby",
    bodyPrompt:
      "Editorial tailor's atelier still life, photographed at slightly-low standing eye level on an 80mm lens in a tight 1:1 composition, soft cool daylight from frame-upper-left through an unseen large window. Surface: a long dark stained tailor's bench with visible long-grain. Across the right half of the frame: the squared edge of a thick folded bolt of charcoal worsted-wool suiting, diagonal weave visible, the fold's sharp crease running vertically. The watch lies on its side along the bench surface in front of the bolt, dial facing camera, crown reading 3 o'clock, bracelet/strap relaxed and partly resting on the front face of the wool bolt where it meets the bench. To the left: a small cluster of brass tailor's pins in a soft pile (about 6 visible), heads catching the light, plus a stub of white tailor's chalk lying parallel. NO other props. Palette: dark stained bench, deep charcoal worsted wool, oiled brass, dusty-white chalk, the watch's own native colour. Sharp focus on the watch and the immediate pins; wool fold and chalk in soft focus. Two named imperfections: fine bench dust along the front edge where the wool meets the wood, one bent tailor's pin slightly out of the cluster.",
  },
  Q_silver_valet: {
    slug: "watch-dressing-valet-silver-tray",
    mode: "homey",
    strategy: "lying-in-tray-with-jewellery",
    anchor: "a hammered silver dressing-valet tray, watch lying dial-up with mother-of-pearl collar stays and a single cufflink alongside",
    bodyPrompt:
      "Editorial gentleman's-dressing-valet still life, photographed at slightly-high looking-down on a 50mm lens in a 1:1 composition, soft warm morning light from frame-upper-left through an unseen sheer curtain. Surface beneath the tray: a wide dark-stained mahogany dresser top with a low-shine satin finish. Centered: a wide rectangular hammered silver dressing-valet tray (about 22 cm wide, 14 cm deep, low rolled edge), the hammered surface catching the morning light in scattered highlights. The watch lies dial-up just left of centre inside the tray, bracelet/strap uncoiled in a relaxed S toward the lower-right corner of the tray. To the right of the watch: a slim pair of mother-of-pearl collar stays lying parallel, plus a single carved tortoiseshell cufflink. Upper-right corner of the tray in slight soft focus: a small folded white linen handkerchief with one visible crease-line. NO other props. Palette: dark-stained mahogany, hammered silver, mother-of-pearl iridescence, tortoiseshell amber, crisp white linen, the watch's own native colour. Sharp focus on the watch and tray surface; collar stays, cufflink, linen in soft focus. Two named imperfections: one faint tarnish trail along the hammered silver near the rolled edge, a single short pull in the white linen handkerchief's weave.",
  },
  R_walnut_burl_tray: {
    slug: "watch-walnut-burl-tray-dried-lemon-leaf",
    mode: "minimalist",
    strategy: "nested-in-wood-tray",
    anchor: "a small walnut-burl tray with a soft beveled lip, watch lying dial-up nested with a single dried lemon leaf at the edge",
    bodyPrompt:
      "Editorial overhead still life, photographed dead-overhead on a 100mm macro lens at a tight 1:1 composition, soft warm window light raking from frame-upper-right. Surface beneath the tray: a fine warm-cream raw silk runner, weave visible. Centered: a small rectangular walnut-burl tray (about 15 cm long, 10 cm wide, satin oil finish, soft beveled inner lip about 7 mm tall, chatoyant burl grain catching the raking light). The watch lies dial-up centred inside the tray, nested into the lip on the longer axis, bracelet/strap uncoiled in a relaxed S that follows the inside curve. Upper-right edge of the tray, breaking the lip slightly: a single dried lemon leaf in soft sage-grey-green. NO other props. Palette: warm-cream silk, deep figured walnut burl, sage-grey-green lemon leaf, the watch's own native colour. Sharp focus on the watch and the tray interior; lemon leaf in slight soft focus. Two named imperfections: a single dust mote visible in the raking light near the lug, a faint hairline crack in the walnut burl finish along the inner short edge.",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Per-product 6-mixes — each product gets a distinct combination
// ───────────────────────────────────────────────────────────────────────────
interface ProductConfig {
  productId: string;
  productTitle: string;
  variantCount: number;
  vibe: string;
  mix: Array<keyof typeof TEMPLATES>;
}

const PRODUCTS: ProductConfig[] = [
  // Plastic PU Business — entry-level office watch
  {
    productId: "cmpz945li007hw29cbnpnpzfz",
    productTitle: "Plastic Round Quartz Analog PU Strap Business Wristwatch",
    variantCount: 3,
    vibe: "literary-office",
    mix: ["F_pocket_square_stack", "D_monograph_stack", "E_open_notebook", "H_saddle_leather_mat", "K_library_armchair", "Q_silver_valet"],
  },
  // Skeleton Chrono — technical / atelier
  {
    productId: "cmpz94cae0092w29cic6901x2",
    productTitle: "Alloy Round Skeleton Quartz Calendar Chronograph Wrist Watch",
    variantCount: 4,
    vibe: "technical-atelier",
    mix: ["A_watchmaker_bench", "L_mariner_chart", "M_architect_parchment", "O_atelier_brass_workbench", "B_leather_watch_roll", "G_cigar_box"],
  },
  // Casual Metal Strap Calendar — lived-in casual
  {
    productId: "cmpz92hjl002rw29caw6u43nu",
    productTitle: "Alloy Round Luminous Hands Calendar Quartz Metal Strap Casual Men's Watch",
    variantCount: 6,
    vibe: "lived-in-casual",
    mix: ["I_travertine_tray", "H_saddle_leather_mat", "J_travel_valet", "N_ceramic_catch_dish", "K_library_armchair", "C_foxed_ledger"],
  },
  // Gold Skeleton — refined dressy
  {
    productId: "cmpz92fuf001zw29c9ftm7v0z",
    productTitle: "Two-Tone Gold Stainless Steel Round Skeleton Quartz Analog Wristwatch",
    variantCount: 6,
    vibe: "refined-dressy",
    mix: ["Q_silver_valet", "D_monograph_stack", "N_ceramic_catch_dish", "R_walnut_burl_tray", "O_atelier_brass_workbench", "C_foxed_ledger"],
  },
  // Screw-Down Crown (diver) — rugged explorer
  {
    productId: "cmpzixtaz00aow2hsqq59fqqx",
    productTitle: "Alloy Round Luminous Screw-Down Crown Quartz Analog Wrist Watch",
    variantCount: 9,
    vibe: "rugged-explorer",
    mix: ["L_mariner_chart", "B_leather_watch_roll", "G_cigar_box", "M_architect_parchment", "O_atelier_brass_workbench", "J_travel_valet"],
  },
  // Moon-Phase Faux Leather — romantic literary
  {
    productId: "cmpz93j6a005pw29ctyaxlzuh",
    productTitle: "Alloy Round Quartz Calendar Moon-Phase Faux Leather Strap Men's Watch",
    variantCount: 6,
    vibe: "romantic-literary",
    mix: ["C_foxed_ledger", "F_pocket_square_stack", "K_library_armchair", "E_open_notebook", "R_walnut_burl_tray", "G_cigar_box"],
  },
  // Glow-in-Dark Waterproof — explorer / mariner
  {
    productId: "cmpzicfd400lvw29co0xa3iss",
    productTitle: "Alloy Round Glow-in-the-Dark Quartz Waterproof Analog Calendar Watch",
    variantCount: 4,
    vibe: "explorer-mariner",
    mix: ["L_mariner_chart", "M_architect_parchment", "A_watchmaker_bench", "B_leather_watch_roll", "J_travel_valet", "H_saddle_leather_mat"],
  },
  // Two-Tone 30M Water Resistant — versatile semi-dressy
  {
    productId: "cmpz94dw6009mw29clgrjcsun",
    productTitle: "Two-Tone Stainless Steel Round Quartz 30M Water Resistant Men's Watch",
    variantCount: 12,
    vibe: "versatile-semi-dressy",
    mix: ["R_walnut_burl_tray", "P_tailors_atelier", "K_library_armchair", "N_ceramic_catch_dish", "D_monograph_stack", "I_travertine_tray"],
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Generator
// ───────────────────────────────────────────────────────────────────────────
function buildJson(cfg: ProductConfig): unknown {
  const scenes = cfg.mix.map((tKey, i) => {
    const t = TEMPLATES[tKey];
    const variantSlot = (i % Math.max(1, cfg.variantCount)) + 1;
    return {
      slug: t.slug,
      mode: t.mode,
      variantSlot,
      strategy: t.strategy,
      anchor: t.anchor,
      prompt: t.bodyPrompt + SHARED_TAIL,
    };
  });
  return {
    productId: cfg.productId,
    productTitle: cfg.productTitle,
    authoredBy: `in-chat batch generator — watches cornucopia v3; vibe=${cfg.vibe}; mix=[${cfg.mix.join(", ")}]`,
    authoredAt: "2026-06-05T00:00:00.000Z",
    classification: "general",
    category: "watches",
    scenes,
  };
}

const outDir = path.resolve(process.cwd(), "scene-overrides");
fs.mkdirSync(outDir, { recursive: true });

for (const cfg of PRODUCTS) {
  const json = buildJson(cfg);
  const outPath = path.join(outDir, `${cfg.productId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`✓ ${cfg.productId}  ${cfg.vibe.padEnd(22)} → ${path.basename(outPath)} (${cfg.mix.join(", ")})`);
}
console.log(`\nWrote ${PRODUCTS.length} scene-overrides JSON files.`);
