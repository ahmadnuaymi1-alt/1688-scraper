/**
 * Single source of truth for the hero-image generation prompt. Used by the
 * CLI batch script (`scripts/probe-hero-higgsfield-v25.ts`).
 */
export const HERO_PROMPT = `CRITICAL LIGHTING DIRECTIVE — READ FIRST: This is a controlled studio shot. The backdrop is gel-lit and color-controlled independently from the product. The product's bulb emits light at its own true color temperature as shown in the reference image — preserve it exactly, do not shift it warmer, cooler, or in any direction to match the backdrop. The backdrop color must NOT tint, cast onto, or influence the emitted light from the fixture. Treat the bulb and the backdrop as two separately white-balanced elements composited into one frame. Especially when the light is a very white light in the reference image, it must also be a same type of white on the generated image.
Professional studio product photograph of the product, centered in frame both vertically and horizontally. Use a 3/4 angle showing the most of the product.
Backdrop: Seamless studio backdrop, flat solid pale greige (hex #ECE6DC), gel-lit with its own dedicated lighting. The floor and back wall blend into one continuous surface — no visible horizon line. Subtle soft vertical gradient, marginally darker toward the lower corners and upper edges. No hard edges, no specular hotspots, no reflections on the floor. The backdrop is purely a color field — it emits no ambient light into the scene and does not interact with the product's bulb.
Product lighting: The fixture's bulb is switched on, emitting light at its reference color temperature. The bulb's light does NOT project, spill, bloom, or cast onto the surrounding backdrop. The product is separately key-lit with neutral 5500K daylight studio strobes for accurate color rendering of the fixture body and accurate display of the bulb's true emission color.
Composition: Square 1:1 frame. Product occupies roughly 60–70% of the frame, perfectly centered horizontally and vertically, with generous negative space above. Camera: full-frame, 85mm equivalent, f/8 for full product sharpness, shallow depth on the background only. Clean, minimal, color-neutral product catalog aesthetic. Photorealistic, sharp focus, no props, no text, no watermark, no people.
Product fidelity: Preserve the exact product design, finish, color, proportions, and construction from the reference image — every component visible in the reference must appear in the output.
Mounting surface (product-aware): Place the product on the surface its design implies:
Flush-mount / pendant → ceiling (top of frame)
Sconce / wall light → wall (back of frame)
Floor lamp → floor (bottom of frame)
Table or desk lamp → tabletop (bottom of frame)
Do not invent a mounting method the product wasn't built for. The mounting point contacts the surface with only a faint soft tonal gradient — no visible plane, no hard edge, no rendered tabletop or wall corner. The surface is implied by the gradient and the product's orientation.
Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`;
