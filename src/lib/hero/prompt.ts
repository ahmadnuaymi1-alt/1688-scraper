/**
 * Single source of truth for the hero-image generation prompt. Imported by
 * every hero pipeline (scripts/_hero-image-creator.ts, scripts/_kie-pipeline-*,
 * scripts/probe-hero-higgsfield-v25.ts, plus the API retry endpoint).
 *
 * Image inputs are unchanged: [variant source/reference, positioning template].
 */
export const HERO_PROMPT = `CRITICAL LIGHTING DIRECTIVE — READ FIRST: This is a controlled studio shot. The backdrop is gel-lit and color-controlled independently from the product. MIRROR THE REFERENCE IMAGE'S BULB STATE EXACTLY — if the reference shows the bulb ON and emitting light, the output must show the bulb ON at the SAME color temperature shown in the reference (do not shift it warmer, cooler, or in any direction to match the backdrop; especially when the reference shows a very white light, it must also be the same type of white on the generated image). If the reference image shows the bulb OFF and NOT emitting light (a dark/unlit shade or a fixture with no glow visible), the output must also show the bulb OFF — no glow, no emission, no light spill from the fixture. Do NOT invent emitted light that isn't in the reference, and do NOT remove emitted light that is in the reference. The backdrop color must NOT tint, cast onto, or influence the emitted light from the fixture. Treat the bulb and the backdrop as two separately white-balanced elements composited into one frame.
Professional studio product photograph of the product, centered in frame both vertically and horizontally. Use a 3/4 angle showing the most of the product.
Backdrop: Infinity cove studio backdrop, flat solid pale greige (hex #ECE6DC), gel-lit with its own dedicated lighting. All surfaces — ceiling, walls, and floor — merge into a single continuous infinite color field. No visible horizon line, no corner edge where two planes meet, no transition between ceiling and wall or wall and floor. The scene contains no architectural geometry. Near-imperceptible soft gradient, very slightly darker only in the extreme outer corners. No banding, no horizon, no visible plane transitions anywhere in the frame. No hard edges, no specular hotspots, no reflections. The backdrop is purely a color field — it emits no ambient light into the scene and does not interact with the product's bulb.
Mounting surface (product-aware): Place the product on the surface its design implies:
Flush-mount / pendant → ceiling (top of frame)
Sconce / wall light → wall (back of frame)
Floor lamp → floor (bottom of frame)
Table or desk lamp → tabletop (bottom of frame)
Do not invent a mounting method the product wasn't built for. The product's mounting point fades into the backdrop with only the faintest contact shadow. There must be NO visible ceiling plane, NO ceiling-to-wall corner, NO wall-to-floor corner, NO horizontal line marking where one surface ends and another begins. The mounting surface is implied only by the product's orientation — never rendered as a distinct plane.
Product lighting: The fixture's bulb state mirrors the reference image — if the reference shows the bulb ON, the output shows it ON, emitting light at the reference color temperature; if the reference shows the bulb OFF, the output shows it OFF with no emission. When ON, the bulb's light does NOT project, spill, bloom, or cast onto the surrounding backdrop. Regardless of bulb state, the product is separately key-lit with neutral 5500K daylight studio strobes for accurate color rendering of the fixture body (and, when the bulb is on, accurate display of the bulb's true emission color).
Composition: Square 1:1 frame. Product occupies roughly 60–70% of the frame, perfectly centered horizontally and vertically, with generous negative space above. Camera: full-frame, 85mm equivalent, f/8 for full product sharpness, shallow depth on the background only. Clean, minimal, color-neutral product catalog aesthetic. Photorealistic, sharp focus, no props, no text, no watermark, no people.
Product fidelity: Preserve the exact product design, finish, color, proportions, and construction from the reference image — every component visible in the reference must appear in the output.
Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`;

/**
 * General (NON-lighting) hero prompt. Same studio-cove look as HERO_PROMPT but
 * with ALL light/bulb/fixture-mount language stripped — it just renders the
 * reference product, unchanged, on the pale-greige infinity cove. Selected
 * automatically by `buildHeroPrompt` when the product isn't a lighting fixture
 * (see `isLightingProduct`). Validated on the wooden-jewellery-box products.
 *
 * Image inputs are unchanged: [variant source/reference, positioning template].
 */
export const HERO_PROMPT_GENERAL = `Professional studio product photograph of the product, centered in frame both vertically and horizontally, shot at a flattering 3/4 angle that shows the product's form, materials, and detail. Backdrop: Infinity cove studio backdrop, flat solid pale greige (hex #ECE6DC), gel-lit with its own dedicated lighting. All surfaces merge into a single continuous infinite colour field — no visible horizon line, no corner edges, no transition between planes. Near-imperceptible soft gradient, very slightly darker only in the extreme outer corners. No banding, no hard edges, no specular hotspots, no reflections. The backdrop is purely a colour field. The product rests naturally on the implied surface its design calls for (a tabletop or shelf for a freestanding object), grounded by only the faintest soft contact shadow. There must be NO visible distinct floor plane, wall plane, or corner line — the surface is implied only by the product's orientation. Lighting: the product is evenly key-lit with neutral 5500K daylight studio strobes for accurate, true-to-life rendering of the materials, finishes, grain, and any hardware. Soft, even, shadow-controlled light with no blown highlights and no colour cast. Composition: Square 1:1 frame. Product occupies roughly 60-70% of the frame, perfectly centered, with generous negative space above. Camera: full-frame, 85mm equivalent, f/8 for full product sharpness. Clean, minimal, colour-neutral product-catalogue aesthetic. Photorealistic, sharp focus, no props, no text overlay, no watermark, no people. Product fidelity: Preserve the EXACT product design, materials, finish, colour, proportions, hardware, and construction from the reference image — every component visible in the reference must appear in the output, unchanged. Do not add, remove, restyle, open, or close any part of the product. Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`;

/**
 * Watch-specific hero prompt. Same studio-cove aesthetic as HERO_PROMPT_GENERAL,
 * but tuned for wristwatches — the case is presented at a soft 3/4 angle with
 * the bracelet curving down-and-back, the crystal is rendered glare-free so
 * the dial is fully legible, and metal finishes (brushed vs polished case,
 * applied indices, polished hands) are preserved per the reference. Backdrop
 * is a slightly warmer pale beige (hex #E8DFCE) than the general greige —
 * matches the user-supplied "Daiska DLA-MARINER" reference style.
 *
 * Selected by buildHeroPrompt() when isWatchProduct(title+productType) is
 * true. First baked-in category override under the cornucopia pattern.
 *
 * Image inputs are unchanged: [variant source/reference, positioning template].
 */
export const HERO_PROMPT_WATCH = `Critical — ignore the supplier scene in image 1: the reference shows the watch sitting on a fabric cushion with a white certificate card or paper tag beside it, sometimes in an open red presentation box. That scene is NOT the output. The output is a clean studio shot of the watch alone, floating on the cove backdrop. Remove the cushion, the certificate card, the paper tag, any hanging string, any presentation box, and any rectangular white paper visible in the reference. Keep ONLY the watch itself (case, dial, hands, markers, bracelet, buckle) from the reference — discard everything else.
Professional studio product photograph of a wristwatch, standing 3/4 angle — case upright, dial rotated 25-30° off head-on, bracelet curving down toward the lower-right. Square 1:1 frame; case body ~40% of frame width, watch + bracelet together ~70%, centered slightly above the midpoint.
Backdrop: flat pale warm beige (hex #E8DFCE) infinity cove, no horizon line, no plane edges. Only the faintest contact shadow under the case. Watch is on no surface — no cushion, no pillow, no roll, no holder, no pad, no stand, no box.
Lighting: soft 5500K daylight, large softbox above and in front, subtle fill from below to lift the lower bracelet. Crystal reads fully transparent — dial, hands, markers, brand name, date numeral, sub-dials all sharp and legible exactly per the reference. No glare, no haze, no bloom on the crystal.
Preserve the watch exactly per the reference: case shape and finish, dial colour, hand and marker style, bezel, bracelet style and per-link finish (two-tone shown per-link), buckle. Dial text matches the reference exactly — never swapped, blurred, or translated.
Don't include any tags. No hang-tag, certificate card, paper label, QR code, barcode, sticker, or string attached to the watch. Nothing dangles off the watch.
Camera: 100mm macro equivalent, f/8. Photorealistic, sharp focus, no props, no hands, no text overlay, no watermark, no people. Image 2 is a positioning template — place the watch inside the rectangle but don't render the rectangle.`;
