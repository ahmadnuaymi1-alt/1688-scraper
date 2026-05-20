---
name: dazuma-aesthetic
description: Style bible for the dazuma.us brand aesthetic — the canonical color/material/architecture/styling/camera vocabulary distilled from a 51-product, 119-image audit of Dazuma's lifestyle imagery. Invoke whenever designing lifestyle scenes, room mockups, or AI image prompts for a luxury indoor or outdoor LIGHTING product (chandeliers, pendants, flush mounts, wall sconces, table lamps, floor lamps, outdoor fixtures) that needs to match the Dazuma look. Triggers: "design Dazuma-style scenes", "match Dazuma brand", "Dazuma aesthetic", "what does a Dazuma lifestyle shot look like", "make this look Dazuma", "/dazuma-aesthetic", or when pairing this with the lifestyle-scene-designer / lifestyle-image-creator skills as the style reference they should pull from. The Dazuma look in one line: AI-rendered idealization of 2024 American "transitional luxury new build" — brass + light oak + cream walls, vaulted/coffered/shiplap ceilings, one olive tree, one cobalt vase of olive branches, vacant-but-styled rooms photographed eye-level slightly-symmetric in slightly-warm daylight, 2700K fixture glow as the only artificial light, and zero human/pet/kid trace.
---

# Dazuma.us Aesthetic — Style Bible

This skill is a reference document. Pull from it when designing lifestyle scenes for any luxury lighting product whose imagery should match dazuma.us. The findings below come from a 51-product, 119-image audit of Dazuma's actual photography (most of it AI-rendered, not photographed).

## How to use this skill

When invoked, treat the patterns below as **hard prescriptions**, not gentle nudges:

- The dominant palettes, materials, and architectural elements are **defaults** unless the product type explicitly suggests otherwise.
- The "what Dazuma does NOT do" section (Section 8) is an **exclusion list** — the AI should actively avoid these things when generating scenes.
- The room/fixture pairings in Section 2 are **prior probabilities** — when picking a room type for a given fixture category, default to the most-frequent pairing.
- The camera and lighting grammar (Sections 4 & 5) is **how Dazuma frames everything** — eye-level, slightly symmetric, warm daylight, fixture as protagonist of an empty room.

If the calling context is a lighting product NOT already in Dazuma's category mix (e.g. some new fixture archetype), interpolate the nearest neighbor pattern from Section 2.

---

## Method

51 product pages scraped across 7 categories (chandeliers, pendants, flush mounts, wall sconces, table lamps, floor lamps, outdoor lighting). 119 gallery images downloaded; ~55 distinct lifestyle/in-context shots visually examined in detail. Pure product-on-white shots, dimension diagrams, finish swatches, and tight detail close-ups were excluded from observation (but counted toward the "what isn't here" pattern).

**Critical preliminary observation:** A very large majority of Dazuma's "lifestyle" imagery appears to be **AI-generated** (Midjourney/SDXL/Flux-style 3D-render aesthetic), not photographed. Tell-tales are everywhere: implausibly clean surfaces, no manufacturer logos on appliances, "Vogue" labels with no readable lower-case body text, identical paneling proportions repeated across products, joints that don't quite resolve, plant leaves that all face the camera. **This shapes everything below — these are renders of an aesthetic ideal, not capture of real interiors.**

---

## 1. Color palettes (most important)

### Wall colors and frequency
- **White/off-white painted plaster (smooth):** ~50% of indoor scenes. Includes warm whites, cream, ivory, and "alabaster" hues. Generally warm-leaning, very rarely cool.
- **Painted-and-paneled walls with applied moulding:** ~35% of indoor scenes. Recessed-panel trim work in white or cream — appears in chandelier bedrooms (chand-04, chand-07, chand-08), pendant dining (pend-02), and most flush-mount living rooms. Frequently classical/Beaux-Arts style with rectangular panels.
- **Vertical shiplap (painted white or natural light pine):** ~20% of indoor scenes. White shiplap on walls and ceilings in chand-01, chand-02 (farmhouse), flush-01. Natural light pine/limed shiplap as accent on ceilings (chand-07 vault, chand-01 bedroom vault).
- **Limewashed/textured plaster:** rare (~5%). Visible only in occasional Mediterranean-feeling outdoor scenes.
- **Wallpaper:** very rare. One example: grasscloth-textured taupe wallpaper in flush-01 staircase. **No floral wallpaper, no patterned wallpaper, no botanical wallpaper.**
- **Painted-color accent walls (sage, dusty blue, gray-green):** ~10%. Chand-05 bedroom (warm gray under white), chand-07 (pale sage shiplap), flush-02 bedroom (sage-gray), flush-06 (sage cottage), flush-03 bedroom (dove-blue board-and-batten wainscoting below chair rail with white above).
- **Real stone (cotswold/honey limestone, river-rock, or stacked irregular fieldstone) feature walls:** present in flush-02 kitchen (full kitchen wall), pend-01 (entire backdrop), outdoor-06 (entry wall). Surprising frequency given the rarity of stone treatments elsewhere.

### Accent color combinations per scene (typical groupings)
The dominant scheme is **warm white/cream + brass + light oak**, often with a single deliberate accent color introduced via textile, art, or ceramic:
- White walls + brass canopy + light oak floor + **sage/seafoam textile accent** (flush-02 bedroom).
- Cream walls + brass + light oak + **dusty rose/blush velvet chairs** (chand-07).
- White walls + brass + walnut table + **deep cobalt-blue ceramic vase** + sheepskin throw (chand-02 dining).
- White walls + brass + light oak + **caramel/cognac velvet bench + striped rust pillow** (chand-04 bedroom).
- Cream walls + walnut + brass + **white linen + olive-tree green accent only** (chand-04 sunlit living, chand-08 dining).
- Gray walls + brass + light oak + **chocolate-brown velvet drapes + cognac leather chairs** (pend-07 dining — strongest jewel-tone moment found).
- Cream/ivory + dusty-blue painted wainscoting + **ticking-stripe textile** (flush-03 bedroom).

The pattern is: muted neutral base + **one** considered accent color per scene. Never busy. Never more than two textile patterns.

### Patterns: where they appear and what kinds
- **Rugs:** the most common location for pattern. Predominantly **jute/sisal flatweave with diamond or chevron texture** (chand-01 bedroom, flush-01 staircase) or **distressed-look oriental rugs in warm rust/cream/black palette** (flush-02 farmhouse kitchen, chand-07 elegant bedroom). Kilim-style rust-and-cream stripe in floor-01 boho. A few examples of soft geometric line-art rugs (flush-02 office).
- **Textiles (pillows, throws):** stripes are the most common pattern — vertical or horizontal **rust+cream+burgundy stripes** (chand-04 bedroom), **ticking stripes** (flush-03 bedroom headboard), **chocolate+cream wide stripes** (floor-05 lounge). Very few florals.
- **Art:** mostly **large abstract block-color paintings** (Rothko/Hodgkin-influenced) in beige+terracotta+navy palette, occasionally swapped for **antique gilt-framed European pastoral landscape oils** (flush-03 bathroom, flush-03 bedroom, sconce-06 living, chand-04 bedroom).
- **Wallpaper patterns:** essentially absent.
- **Block prints / botanical / chinoiserie / geometric tile:** essentially absent except for one **sage/teal botanical floral curtain** (sconce-08) and one **chintz floral upholstered headboard** (flush-06 — quite an outlier).

### Saturation
- **Muted-mid dominant** (~75%). Cream, oat, sage, dusty blue, terracotta-tinted browns, mushroom — all desaturated tertiary tones.
- **Mid:** ~20%, when a single jewel-tone accent enters (cognac leather, cobalt vase, sage velvet sofa).
- **Saturated:** ~5%. Rare cases: pend-01 marble-dining with its 4-color striped bowl + bronze metallics + glamorous look, flush-06 chintz floral, the colorful glass-pebble sconces.

### Wood tones
- **Light oak / white-oak / natural-pine (limed or sanded light):** by far the dominant tone. Used for floors, dining tables, kitchen islands, cabinetry, headboards, nightstands, dressers. Often shown in slab construction or shaker style with brass hardware. Appears in roughly 70% of indoor scenes.
- **Dark walnut / reclaimed timber:** secondary, used as accents — exposed ceiling beams (chand-02 farmhouse, chand-05 dining), credenzas (chand-05), dining tables (chand-02 dining), coffee tables (chand-04 sunlit living, table-01 charming, table-04). Roughly 30% of indoor scenes.
- **Mahogany / dark cherry / rosewood traditional:** very rare. Only the flush-02 office library and sconce-08 boho bedroom show it.
- **Painted wood:** white shaker cabinets in kitchens (chand-02, pend-01 single-opal scene, flush-01, flush-02), white-painted shutters on windows.
- **Reeded / fluted wood detailing:** common feature — fluted kitchen island bases (chand-01 kitchen), fluted credenzas (sconce-04), fluted pedestal tables (flush-02). A clear current-trend signal in the renders.

### Stone types and locations
- **White Calacatta/Carrara-style marble with gray veining:** kitchen islands and backsplashes — the single most repeated stone. Approximately 60% of kitchens show it. Often as waterfall edge.
- **Honed gray/charcoal marble:** dining table tops (pend-01 marble-dining), bathroom counters (rarely), feature walls (chand-06 luxury living's bookmatched white-and-gray feature wall).
- **Calacatta gold (gold-veined warm marble):** less common but present (pend-01 modern-kitchen, pend-07 marble kitchen).
- **Black marble:** dining tables (chand-06 formal, flush-05 dining, flush-07 dining), fireplace mantel (flush-04 living).
- **Travertine / limestone:** rare interior use; large limestone pavers (flush-02 kitchen floor) and Cotswold-style cut limestone (flush-02 backsplash).
- **River-rock / stacked irregular fieldstone:** outdoor entry walls (outdoor-06) and pend-01 single-opal kitchen feature wall.

### Metal finishes
- **Brass (unlacquered / antique / aged brass) — overwhelmingly dominant** for indoor fixtures (~70%). Brass canopies, brass arc faucets, brass cup pulls, brass curtain rods + finials, brass cabinet hardware, brass tipped chair feet, brass picture-frame edges.
- **Matte black / wrought iron** — second most common (~25%), particularly for chandelier cages (chand-02, chand-06), pendant frames (pend-04), French-door window frames, exterior fixtures, curtain rods on darker scenes.
- **Polished chrome / nickel:** rare (~5%) — only on a few sconces (sconce-06 hallway, sconce-07) and the occasional contemporary kitchen pendant (pend-07 marble kitchen).
- **Bronze / weathered bronze:** confined to traditional outdoor fixtures (outdoor-02 driveway, outdoor-03 walkway) and the occasional "luxury-traditional" indoor (chand-06 luxury living's screen panels).

### Warm-dominant vs cool-dominant: overall verdict
**Strongly warm-dominant.** Cream walls, light oak woods, brass metals, warm-gold daylight, golden-hour ambient. Cool moments exist as deliberate contrasts (the slate-blue figurative art in floor-01 bedroom, the sage and dusty-blue accents in flush-03 and flush-06, the polished concrete floors in pend-07 and chand-06 formal). The brand reads warm, layered, and intentionally non-modern-tech-cool.

---

## 2. Room types and frequency

Rough breakdown across the ~55 in-context indoor and outdoor scenes examined:

- **Kitchens** (~22%) — far the most common room. Subdivides into:
  - White-marble-island + brass-pendant kitchens (most common, ~10%)
  - Country/farmhouse with butcher-block or wood island and beam ceiling (~6%)
  - Asian-modern/Japandi light-oak slab kitchens with marble waterfall (~5%)
  - One Cotswold/English-country with stone backsplash (flush-02)
- **Dining rooms** (~18%) — second most common. Wood-slab tables, boucle or upholstered chairs, large abstract or pastoral art, French-door access to landscape.
- **Bedrooms** (~22%) — primary bedrooms only. Tufted/upholstered headboards in cream linen or boucle dominate; secondary headboards include light-oak panel and rustic-distressed plank. Sage/dusty-blue or cream walls.
- **Living rooms / sunrooms** (~12%) — typically slipcovered ivory sofas + jute rug + olive tree or fiddle-leaf-fig in concrete planter, OR formal Beaux-Arts apartment with boucle chairs around marble pedestal coffee table.
- **Hallways / corridors / foyers** (~12%) — recurring scene type. Always vaulted or coffered, often with a French/divided-light entry door. No people; minimal styling. The hallway is the dominant "secondary-room" scene Dazuma photographs.
- **Bathrooms** (~3%) — limited; only flush-03 bathroom and a couple of vanity-light products not in the sampled set.
- **Home offices / libraries** (~3%) — flush-02 home office (Japandi) and flush-02 library office (traditional Parisian) — one of each.
- **Staircases as backdrop** (~3%) — multiple foyer shots include staircase as architectural feature.
- **Hospitality / lobby / lounge** (~3%) — the chand-06 luxury living scene reads as hotel lobby; table-05 reads as resort lounge.

**Outdoor rooms (separate sample, ~12 examined):**
- **Mediterranean coastal poolside dusk** (~50% of outdoor) — twilight, infinity pool, palm or olive backdrop, white deck cushions, wood-deck or pale-stone paving.
- **Modern minimalist front entry at dusk** — limestone-stucco facade, dark walnut slab doors, native-grass landscape (outdoor-06).
- **Traditional Colonial driveway with brick path** (outdoor-03 walkway).
- **Spanish Mediterranean revival garden path** (outdoor-03 garden).
- **Suburban-tract-home front yard** (outdoor-02) — the only "ordinary America" outdoor moment.
- **Forest/woodland** (outdoor-08) — only for the decorative deer-silhouette product.

**Surprising room types:** the **vaulted-ceiling hallway** appears in almost every chandelier listing and is one of Dazuma's signature scenes. The **classic Parisian apartment** with ornate plaster cornicing and Beaux-Arts mouldings (flush-04, flush-07) is unexpectedly present — that's a very specific European reference that mixes with the otherwise American suburban-luxe palette. The **hotel/contract scenes** (chand-06 luxury living, table-05 lounge) feel out of place alongside the residential work.

**Which fixture categories appear in which rooms:**
- **Chandeliers:** dining rooms (~40%), bedrooms (~30%), vaulted living rooms / vaulted hallways (~25%), formal dining/lobby (~5%).
- **Pendants:** kitchens over islands (~50%), dining rooms (~30%), bedrooms (~15%), other (~5%).
- **Flush mounts:** bedrooms (~30%), hallways/foyers (~20%), kitchens (~20%), bathrooms (~10%), living rooms (~10%), home offices (~10%).
- **Wall sconces:** bedrooms beside bed (~40%), beside accent furniture (console/credenza, ~30%), bathroom mirrors (~10%), corridor/hallway (~20%). Many are isolated against blank-wall studio scenes.
- **Table lamps:** living-room side tables (~50%), bedroom nightstands (~40%), occasional desk/lounge (~10%). Tight 1-prop styling with vase + branches + tray.
- **Floor lamps:** living rooms beside sofas (~70%), bedroom corners (~30%).
- **Outdoor:** pool decks (~40%), front-entry walkways and driveways (~30%), garden paths (~20%), forest (~10%).

---

## 3. Architectural elements

### Ceiling treatments (with rough frequency)
- **Smooth painted white plaster ceilings:** ~50% — the default.
- **Vaulted/cathedral ceilings, often A-frame or steep:** ~25%. Three sub-types observed:
  - White shiplap vault (chand-01 vaulted living, chand-01 bedroom)
  - Natural light-pine plank vault (chand-08 dining, chand-07 bedroom)
  - Painted white vault with exposed gray-painted rafters (chand-07 vaulted bedroom)
- **Coffered ceilings with painted-white beam grid and pine-plank infill panels:** ~10% (chand-01 hallway is the canonical example, chand-03 corridor variant).
- **Exposed reclaimed-wood beams on white plaster:** ~10% (chand-02 farmhouse kitchen, chand-02 hallway, chand-05 dining, chand-08 dining).
- **Ornate plaster cornicing/cornicing with floral cartouches (Parisian/Beaux-Arts):** ~5% (flush-04 living, flush-07 dining, flush-02 library, pend-06 with applied ceiling medallion).

Notable absences: **no tray ceilings, no ornate medallions other than the one Parisian "elaborate" example, no painted ceilings other than white/cream, no wallpapered ceilings.**

### Wall treatments
- **Applied-moulding rectangular wall panels (recessed-panel applied trim):** the single most-repeated wall treatment — appears in roughly 35% of indoor scenes. Used in formal bedrooms, living rooms, dining rooms.
- **Vertical shiplap (white painted):** ~15%, in hallways, kitchens, occasional bathroom.
- **Wainscoting + plain plaster above:** ~15%, often in foyers and hallways. Heights vary from chair-rail height (3-4 ft) up to two-thirds-wall plate height. Painted-white shaker raised-panel wainscoting is the default; dove-blue or sage-painted wainscoting appears in a few country scenes.
- **Beadboard:** rare but present in chand-02 hallway.
- **Slatted reeded wood paneling (vertical narrow grooves) in light oak or walnut:** ~10%, contemporary accents (flush-05 dining walnut slat wall, flush-07 light-oak slat wall, pend-07 dining accent).
- **Real stacked stone:** ~5% (flush-02 kitchen, pend-01 single-opal scene, outdoor-06 entry).
- **Brick (white-painted or red exposed):** rare — white-painted brick fireplaces (chand-05), red brick exterior (outdoor-03 walkway).

### Window styles
- **Multi-paned divided-light windows (double-hung or casement) in white-painted frames:** the absolute default — ~65% of windowed scenes.
- **Black steel-framed (Crittall-style) casement windows or French doors:** ~25%, particularly in chand-01, chand-02 dining, chand-03 corridor, chand-04 bedroom. Always presented as a deliberate modern accent.
- **Plantation shutters (white, louvered):** ~15%, in country/formal bedrooms (chand-07 elegant, chand-08 bedroom, flush-02 bedroom, flush-03 bedroom).
- **Picture/floor-to-ceiling unmullioned windows:** ~10%, in contemporary or hospitality scenes (chand-06 formal, pend-07 dining).
- **Arched windows:** rare (~3%); flush-07 dining and flush-03 walk-in shower opening.

### Floor treatments
- **Wide-plank light-oak or white-oak flooring:** ~55% of indoor scenes. The default.
- **Herringbone parquet or large-square parquet de Versailles:** ~10%, exclusively in formal Parisian-style scenes (flush-04 living, flush-07 dining).
- **Dark walnut/cherry plank:** ~10%, in formal traditional scenes (chand-05 dining, flush-02 library).
- **Polished concrete:** ~5%, in contemporary/hospitality scenes (pend-07 dining, chand-06 formal, floor-01 boho/Med).
- **Polished marble tile:** ~3%, in hospitality scenes (chand-06 luxury living).
- **Penny tile (white) for bathroom floor:** rare (flush-03 bathroom).
- **Cotswold-cream limestone large-format pavers:** rare (flush-02 farmhouse kitchen).

### Trim/millwork details
Heavy use of: **classical white-painted crown moulding, white baseboards (6-8" tall), white casing around windows and doors, white wainscoting cap rail, recessed-panel applied trim on walls**. Almost universal. The renders lean toward classical American architectural detailing as the default. Brass curtain rods with ball finials appear in roughly 30% of windowed scenes.

---

## 4. Camera and framing

- **Camera height:** **dominantly eye-level or slightly elevated** (~80%). The vaulted-ceiling shots are taken at standing-eye height looking diagonally up and forward, allowing the fixture to be centered in negative ceiling space without distortion.
- **Angle relative to fixture:** **slight up-angle or level** is most common. The fixture is rarely below the camera. For chandeliers/pendants this means the fixture is in the upper third of the frame with the room context filling the lower two-thirds.
- **Lens character:** appears to be **neutral 35-50mm equivalent**, not wide-angle dramatic. Geometry is rectified, no fisheye distortion, no Architectural-Digest-wide-angle. (This is an AI-render bias: pseudo-photographic compositions.) A few outdoor scenes use slightly wider apparent FOV (outdoor-01 pool with multiple lanterns).
- **Fixture-to-frame ratio:** **medium ~10-20%** is the dominant choice. The fixture is clearly the subject but the room reads as cohesive — not a hero macro shot, not a buried-in-context shot. Chandelier shots specifically tend to put the chandelier at ~15% of frame area, prominently centered horizontally.
- **Composition conventions:** **strongly centered/symmetrical** (~70%). The fixture sits centered horizontally, often with mirror-symmetrical staging beneath (matching nightstands, matching chairs, paired vases). The remaining ~30% use rule-of-thirds with the fixture off-center over an island or table.
- **Fixture as subject vs. one element in room:** **fixture is unambiguously the subject** in every shot but the room is given enough breathing room to read as the destination context. The styling does not compete with the fixture (which would be a Visual Comfort lifestyle convention) — the fixture is centered, lit, and prominent.

A specific Dazuma framing signature: **looking straight down a hallway toward a French/divided-light door**, with the fixture hanging in the upper-center of the frame. Used repeatedly (chand-01 hallway, chand-02 corridor, chand-03 corridor, flush-01 staircase variant). It's a "passage shot" — perspective-symmetric, centered, vanishing-point through a door.

---

## 5. Lighting character

- **Time of day suggested:** **mid-morning to early afternoon daylight** for ~70% of indoor scenes. **Golden hour / warm late-afternoon** for ~15%. **Evening/dusk with lights on** for ~10% (mostly outdoor). **Nighttime** for the remainder (outdoor evening, bedroom mood shots).
- **Warm-cool color temperature relationships:** The fixture's bulbs glow **warm (2700-3000K equivalent)** in every shot. The ambient daylight typically reads **slightly warm-neutral** with the brightest highlights pushed slightly toward gold. There's deliberate slight cool-warm contrast (cool blue-tinted exterior daylight visible through windows + warm interior wood/brass tones) — a classic AI-render move.
- **Visible ambient sources beyond hero fixture:** mostly limited. Table lamps and floor lamps occasionally appear alongside the hero fixture as supporting glow. Recessed ceiling cans are essentially absent (the hero is the room's only fixture in ~90% of shots).
- **Window light character:** **soft diffused** dominates — the windows are bright but not blown-out, with greenery or trees showing softly outside. **Directional sunlight** is occasionally used (chand-04 sunlit living has visible warm-gold rake across the wall). Outdoor evening scenes have **deep navy-blue dusk skies** with peach/mauve horizons.

---

## 6. Styling vocabulary

### Recurring object types with rough frequency

- **Branches/stems in a vase** — present in roughly **75% of staged indoor scenes**. Far and away the dominant styling prop. Specific stems seen:
  - **White hydrangea/viburnum bouquets** (pend-06 dining, sconce-06 living dried, flush-02 kitchen, chand-04 sunlit living, chand-07 vaulted bedroom)
  - **Olive branches with pale green leaves** (chand-04 sunlit living, flush-01 hallway, chand-08 bedroom potted)
  - **Cherry/plum blossom branches** (pend-02 dining, table-01 charming, table-04 cozy)
  - **Eucalyptus stems** (flush-02 bedroom, sconce-05 bedside)
  - **Pussy willow / yellow-budded stems** (pend-01 modern kitchen with brass)
  - **Dried pampas grass plumes** (pend-08 ambient headboard, sconce-04 face-vase)
  - **Dried branches with seed pods** (chand-08 dining, flush-02 office)
- **Ceramic vases** — present in ~80% of staged scenes. Concrete recurring types:
  - White textured/cream stoneware urns (the most common — pend-02 dining x2, chand-04 sunlit, flush-01)
  - **Deep cobalt-blue glazed urns** (flush-01 hallway — two flanking)
  - Black ceramic ginger jars (chand-02 dining, sconce-05)
  - Terracotta/clay-textured vases (pend-07 marble kitchen, chand-08 dining)
  - Sage/dusty-green glazed (pend-06)
- **Books** — present in ~40% of scenes:
  - **Stacks of 2-4 design books** (pend-01 subway-tile-kitchen has "Vogue Living", "Saint Laurent" titles; sconce-05 has "ARTS PAPER SECRET" titles; pend-01 stone-wall, flush-02 home office)
  - Hardback design books face-up, dust jackets often replaced with neutral cream/oat covers
  - **Open coffee-table magazine** on couch (table-05 lounge with open interior-design magazine)
  - **Antique leather-bound books filling traditional shelves** (flush-02 library)
  - **Open notebook with pen** (flush-02 home office) — implied "in-use"
- **Bowls and trays:**
  - Dark walnut serving trays as base for vase + books (table-01, table-04 cozy)
  - Woven straw circular trays (sconce-06 living)
  - White-glazed shallow ceramic centerpiece bowls (pend-02 dining, chand-02 dining)
  - **Citrus fruit (oranges/apples) in bowl on island** (chand-01 kitchen) — a very specific recurring prop
- **Candlesticks / candles:** uncommon. A small brass candleholder appears in flush-05 dining; chand-05 has actual lit candle bulbs styled to mimic candles.
- **Mineral specimens / crystals:** rare but present (table-05 cocktail-rocks bowl).
- **Brass / metallic accent objects:** brass alarm clock (table-02), brass-coated decorative bottles (pend-01 marble-dining), brass urn-ceramics (pend-07 dining).

### Foliage / natural elements
Heavy: dried + fresh stems in vases dominate. Live potted plants appear less frequently — **olive tree in concrete planter** is a strong recurring motif (chand-04 sunlit, chand-08 bedroom). **Fiddle-leaf fig in white ceramic planter** appears twice (chand-08 dining, pend-07 dining, flush-02 bedroom). Living-wall greenery appears in outdoor/hospitality (table-05 lounge). **Cut flowers in vases — pink-roses, dusty-roses, white-roses, peonies, hydrangeas — appear in ~25% of staged scenes**, mostly bedrooms and dining.

### Books — design books, vintage hardcovers, paperbacks?
A mix: in modern Japandi scenes, books appear as **paperback or trade-paperback stacks** with visible spines and contemporary titles (sconce-05's "ARTS PAPER SECRET"). In design/style scenes, **hardback coffee-table design books with neutral cream/oat dust jackets** are stacked horizontally on side tables or coffee tables. In traditional library scenes (flush-02), **leather-bound antiquarian books** fill built-in shelves. **Stacking conventions:** 2-3 books horizontal with smaller object on top, almost always against a vase.

### Ceramics breakdown
- **Stoneware (matte, cream/oat, textured)** is by far the most common type — a clear contemporary-craft preference.
- **Glazed urn-jar** styles (deep cobalt, sage, terracotta) appear as accents.
- **Black ceramic ginger jars / ovoid vases** for moody scenes.
- **Glass and crystal:** clear bud vases for cherry blossoms; cut-crystal whiskey tumblers in eclectic scenes (sconce-08).
- Notable absence: **no chinoiserie-style blue-and-white ginger jars, no patterned Talavera/Spanish/Mexican ceramics, no Moroccan/Berber pottery (despite the Mediterranean lean).**

### Density per surface
**Low density.** A typical Dazuma side table has **1-3 objects**: a vase with stems + a stack of 2 books + occasionally a ceramic bowl. Coffee tables have similar density: tray + vase + stack of books. Console tables: vase + sculpture/bowl + lamp (if no sconce). Nightstands: lamp + book + small vessel + (sometimes) framed art at angle. **The styling sensibility is "Japandi/curated-magazine," not "English-country-overstuffed" or "Pottery-Barn-warm-and-full."**

### Implied human presence
Surprisingly limited. Dazuma's renders **almost never include open books, half-finished drinks, draped jackets, mussed bedding, or any of the canonical "someone was just here" cues**. Exceptions where these cues appear:
- **Mussed bedding** in pend-08 ambient headboard and chand-05 bedroom (subtle pillow disarray)
- **Open magazine** on sofa in table-05 lounge
- **Open notebook with pen + coffee** in flush-02 home office
- **Casually draped chunky-knit throw** on bench in chand-02 hallway
- **Half-finished coffee cup** on side table (chand-07 elegant bedroom)
- **Family photo + perfume bottles + tumbler** in sconce-08 boho bedroom (the most "lived-in" of all)

These are scattered across only ~15% of shots. The dominant mode is **immaculate, just-staged, gallery-clean.**

---

## 7. Mood and emotional tone

- **Time of life / activity suggested:** **prosperous-young-adult to middle-age** — well-set spaces with no children's toys, no pets, no family photos (save sconce-08), no signs of work-from-home laptops (save pend-05 cluster which has a visible MacBook with mountains-screensaver). The aesthetic suggests **first-or-second luxury home, polished, presentable for showings**.
- **Lived-in vs. staged spectrum:** very strongly **staged**. ~85% read as professionally styled / showroom / model-home. The few "lived-in" cues (above) are atomically small.
- **Quiet / energetic / romantic / scholarly / practical:** **quiet** is the dominant register (~70%). **Romantic** (~10%) appears in the dusty-rose-velvet bedrooms (chand-07 elegant) and the flush-06 cottage. **Scholarly** (~5%) in flush-02 library and home office. **Practical/energetic** essentially absent — no breakfast-in-progress, no working sinks, no actual cooking.
- **Occupied (recent activity) vs. empty rooms:** **empty rooms** dominate (~80%). The "passage shots" (hallways/foyers) are completely empty of anything but the architecture and lamp. Kitchens have styled fruit-bowls but no actual food prep. Dining rooms have decorative centerpieces but no plates. The renders are spaces awaiting their occupant, not capturing one.

---

## 8. What Dazuma does NOT do (anti-patterns)

Notable absences given what one would expect from "luxury lighting" imagery. **Treat this list as a hard exclusion list when generating Dazuma-style scenes.**

- **No live human bodies, faces, hands, or even silhouettes** — never. Not even out-of-focus background figures.
- **No pets** — not a single dog, cat, or even pet-related prop.
- **No children, no kids' rooms, no cribs, no toys, no bunk beds** — every bedroom is a primary master suite.
- **No casual everyday objects** — no phones, no laptops (other than the one MacBook), no remotes, no charging cables, no eyeglasses left on a book, no half-finished wine glasses.
- **No food in actual preparation** — no chopped vegetables, no flour on counter, no boiling pot, no plated meal.
- **No wallpaper patterns** — strikingly absent given the AD-tier reference. No Schumacher, no de Gournay, no William Morris, no botanical block prints on walls. The brand seems wallpaper-averse.
- **No bold saturated paint** — no inky navy walls, no deep forest green, no oxblood, no Yves Klein blue. Walls are almost always white/cream with one or two dusty-pastel accent rooms.
- **No personal-history objects** — no record collections, no photo walls, no travel souvenirs, no collected ceramics groupings.
- **No outdoor patio cushions in floral/striped patterns** — outdoor textiles are always solid white or cream.
- **No 19th-century-style antiques as primary furniture** — no carved Victorian sideboards, no Louis-XVI gilt chairs, no Chesterfield-with-deeply-worn-leather, no Persian Heriz rugs. Even the "traditional" scenes (flush-02 library, flush-03 bathroom) are clearly modern interpretations.
- **No truly contemporary daring art** — abstract paintings are present but they're all the same Hodgkin/Rothko/Diebenkorn family of neutrals + one warm accent. No Lichtenstein, no Basquiat-style canvas, no graffiti or pop-art.
- **No textured handmade rugs that look truly old** — even oriental rugs read "new distressed-look" rather than truly heirloom.
- **No Mediterranean-tile-pattern moments** — given how often the outdoor renders evoke Italy/Spain, there are no zellige walls, no Spanish patterned tiles, no terracotta-painted floors, no plastered chimneys with Provençal feel inside.
- **No bookshelves overstuffed with paperbacks or actual personal libraries** — books are always staged and curated.
- **No outdated 2010s aesthetic** — no chevron flooring as primary, no "live-laugh-love" signs, no edison-bulb-cage-pendant-only kitchens, no all-gray-everything.
- **No bold supergraphic wall murals or large-scale photography** — art is always painting-format.

---

## 9. Synthesis

### 5-7 most defining patterns
1. **Vaulted, coffered, or shiplap ceilings are the architectural hero**, used to give the fixture context. Roughly half of all chandelier and large-pendant shots feature a vaulted/coffered/beamed ceiling — far more than typical luxury catalogs.
2. **Brass + light oak + cream/white is the canonical material trio**, applied to ~70% of indoor scenes regardless of fixture category. It is the brand's house palette.
3. **The hallway/foyer "passage shot"** — looking straight down a corridor toward a French/divided-light entry door with the fixture centered overhead — recurs across products as a signature framing.
4. **One deliberate accent color per scene** introduced through a single textile, a velvet chair, or a colored ceramic vase. Otherwise muted neutrals. Pattern stacking is rare — usually one striped pillow OR one printed rug, never both.
5. **Stems/branches in a ceramic vase + 2-3 stacked books = the styling default** for ~75% of staged surfaces. Other styling props (candles, sculptures, photos, family items) are vanishingly rare.
6. **Spaces are empty of human trace** — staged for camera, not occupied. No people, no pets, no kids, no food prep, no clutter, no lived-in mess.
7. **Daylight-saturated, slightly warm, eye-level, centered/symmetrical composition** is the dominant photographic grammar. Wide-angle dramatic shots are rare; moody nighttime shots almost exclusive to outdoor product.

### Single most surprising / counter-intuitive observation
The imagery looks **almost entirely AI-rendered, not photographed** — yet the renders aim to evoke **specific, narrow American taste references** (white-shiplap vaulted ceilings of Studio McGee, light-oak kitchens of Amber Lewis, brass-and-cream of Marie Flanigan, Beaux-Arts apartments of Pierre Yovanovitch). The strangest moment is the occasional **Parisian-Beaux-Arts apartment with elaborate plaster cornicing** dropped into a catalog of otherwise California-Modern-Farmhouse imagery — it feels like prompts pulled from very different aesthetic libraries within the same brand.

A second surprise: **Dazuma photographs a tremendous number of hallways, foyers, and corridors** — secondary spaces that most luxury lighting brands skip in favor of bigger statement rooms. This may reflect product mix (their flush mounts and small pendants need hallway homes) but it has become a brand-recognizable framing.

### Aesthetic position relative to comparators
- **Visual Comfort:** Dazuma is far more **architectural-render** and less **photo-real**. Visual Comfort uses real photographers, real rooms, more human styling cues (a stack of well-loved books, a folded throw with wear), and richer color (deep navy walls, oxblood rugs). Dazuma is cleaner, lighter, lower-saturation, and AI-aesthetic.
- **Pottery Barn:** Dazuma is **more aspirational and more architectural**. Pottery Barn shows kid-friendly family rooms, mid-tone walls, warmer family-life styling. Dazuma is statelier, less family-occupied.
- **Schoolhouse Electric:** Both share a craft-and-traditional sensibility, but Schoolhouse leans **darker, more saturated, more handmade-feeling** (navy walls, deep greens, oxblood, walnut everywhere). Dazuma is paler, brighter, and more architectural-render.
- **Cedar & Moss:** Cedar & Moss leans **PNW-modern with darker walls and mid-century furniture**. Dazuma is sunnier, more Sun-Belt-luxe, brighter, less moody.
- **Allied Maker:** Allied Maker uses **stark gallery-white minimalist contemporary art-collector** scenes. Dazuma is far more **suburban-AD warm-traditional** by comparison.
- **Restoration Hardware:** RH uses **moody industrial-luxe** with concrete floors, raw linen, oversized scale, deeply saturated grays and browns. Dazuma is the inverse: lighter, brassier, more cream-and-pine.

If asked to place Dazuma on a single map: **between Studio McGee aspirational-shelter-Pinterest and Visual Comfort traditional-trade**, but rendered through an AI lens that flattens everything to a slightly-too-clean, slightly-too-symmetrical version of California/Texas/Florida new-build luxe. The brand approximates a Sun-Belt new-construction taste profile served through prompt-engineering.

### The hard-to-articulate "Dazuma-ness"
**Dazuma-ness is the AI-rendered idealization of a 2024 American Pinterest board for "transitional luxury new build"**: white-painted millwork, light oak floors, brass fixtures, vaulted ceilings, a single olive tree, a Calacatta-marble kitchen island, an empty vaulted hallway leading to a black-framed glass door, a cobalt ceramic vase of olive branches, and a single 2700K-glowing fixture as the room's only light source. It is the **un-occupied dream of a home you are about to move into**, not the home itself. There is no dust, no past, no friction, no chaos, no human warmth — only the architectural and material vocabulary of warmth, perfectly arranged for the camera. The fixtures are the protagonists of empty rooms that have not yet been lived in.
