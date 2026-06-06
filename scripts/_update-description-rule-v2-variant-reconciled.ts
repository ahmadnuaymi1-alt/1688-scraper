/**
 * V2 update of the user's enabled "description" TransformationRule.
 *
 * Goals (driven by the messy Specifications on real products):
 *   1. RECONCILE the Specifications table with the LIVE variants — the variant
 *      list is the source of truth for what the customer can select.
 *   2. Clean dimension layout: state constant dims once + the varying dim as a
 *      selectable set; NO "Dimensions (30cm)" one-row-per-size with the size in
 *      the label. (Distinct named designs still keep per-design rows.)
 *   3. Consolidate non-selectable option properties (per-size wattage, etc.)
 *      into a single range — never a per-option breakdown that implies a choice.
 *   4. Reconcile contradictions (Lamp Width vs variant width, IP65 vs IP55).
 *   5. Drop physically-implausible values (e.g. "Weight: 2 g" / "0.004 lb").
 *   6. Drop obscure supplier brand rows (esp. with Chinese characters).
 *   7. Switch the rule's model to gpt-5.4-mini.
 *
 *   npx tsx scripts/_update-description-rule-v2-variant-reconciled.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const USER_EMAIL = "ahmadnuaymi1@gmail.com";
const NEW_MODEL = "gpt-5.4-mini";

const DESCRIPTION_PROMPT = `Output ONLY valid HTML. Rewrite in your own words.

=== VARIANT RECONCILIATION — READ FIRST, APPLIES TO THE WHOLE OUTPUT ===

The "Available variants" list in the product context is the SINGLE SOURCE OF TRUTH for what the customer can actually buy and select. Every section — the paragraphs, the Specifications table, AND the FAQ — MUST stay consistent with it:

- The customer can ONLY choose the axes shown in "Available variants" (e.g. if the only axis is Size, then Size is the ONLY thing they pick).
- NEVER present a property as selectable, or break a spec down per-option, when that property is NOT one of the live variant axes. If wattage / power / color temperature / finish varies in the raw source but is NOT a selectable variant, collapse it to ONE consolidated value or range — do NOT list it per size or per option (that implies a choice the customer cannot make). This applies to the paragraphs and FAQ too: never say the product "is offered in" / "is available in" / "you can choose" an option the customer cannot actually select (e.g. do not tell them they can pick a color temperature when it is not a variant); describe such properties as fixed specs, not choices.
- If a raw spec value CONTRADICTS the live variant labels, the variant labels WIN — drop the contradicting spec.
- Treat the dimension strings inside the variant labels (e.g. "4.7\\"W × 11.8\\"H × 6.3\\"D") as the AUTHORITATIVE dimensions. Never introduce different width / depth / projection numbers that disagree with them.

STRUCTURE, in this exact order:

=== DESCRIPTION TAB ===

<h2> with product type + primary benefit, NOT the product title, NO brand names, NO colons

Good:

Rechargeable Cordless Table Lamp with Touch Dimming

Bad:

Luna: Battery Operated Table Lamp

Three <p> paragraphs, 3–4 sentences each, 40–70 words each:

P1: Factual overview with primary keyword, material, finish/design, main use case

P2: Key benefits, standout features, what differentiates the product

P3: Target audience, ideal use scenarios, trust signals

<p><strong>What's Included</strong></p>

<ul> list, NOT a heading, keep inside <p>

🚨 WHAT'S INCLUDED — SINGLE FLAT LIST, CRITICAL:

The "What's Included" block is ONE flat <ul> describing what arrives in the box (fixture, remote, mounting hardware, manual, accessories). NEVER break it down per variant, per size, per color, or per configuration. The customer already sees variant-specific specs in the variant selector and in the Specifications table; do NOT duplicate them here.

If different variants ship slightly different things, describe the contents generically ("ceiling light fixture, size as selected") and let the variant selector handle the specifics. ONE bullet per box-content item, maximum 5 bullets.

✅ Correct What's Included:

<p><strong>What's Included</strong></p>
<ul>
  <li>Wall sconce fixture (size as selected)</li>
  <li>Mounting hardware and installation guide</li>
</ul>

❌ Incorrect What's Included (DO NOT EVER OUTPUT THIS PATTERN):

<p><strong>What's Included</strong></p>
<ul><li>Wall sconce fixture</li>...</ul>
<p><strong>23.6" Variant</strong></p>
<ul><li>Dimensions: 23.6"W × 1.2"H × 2.0"D</li><li>Power: 12W</li>...</ul>

The per-variant pattern is FORBIDDEN. Variant-specific dimensions, wattage, and coverage belong in the Specifications table only.

=== BENEFITS TAB ===

<h3>Benefits</h3>

3–5 benefit entries. Each must follow this EXACT structure:

<p><strong>Benefit Title</strong><br>One sentence describing this benefit.</p>

🚨 STRICT FORMATTING RULE, CRITICAL

ONLY the title inside <strong> is bold.

The description MUST be plain text, NOT bold.

Do NOT wrap the entire <p> in <strong>.

Do NOT bold any text after <br>.

Do NOT add extra tags inside <p>.

✅ Correct Example:

<p><strong>Durable Materials</strong><br>Crafted from high-quality stainless steel for long-lasting wear.</p>

❌ Incorrect Examples:

<p><strong>Durable Materials<br>Crafted from high-quality stainless steel for long-lasting wear.</strong></p>

<p><strong>Durable Materials</strong><br><strong>Crafted from high-quality stainless steel for long-lasting wear.</strong></p>

=== SPECIFICATIONS TAB ===

<h3>Specifications</h3>

A single <table> of clean, customer-facing specs:

<table>
<tr><th>Spec Name</th><td>Spec Value</td></tr>
</table>

DIMENSIONS — present them CLEANLY, consistent with the size variants. Choose ONE of two formats based on how many dimensions change across sizes, and NEVER mix them:

CASE A — only ONE dimension varies across sizes (e.g. width + depth constant, only height changes): state each CONSTANT dimension as its own row, and the single varying dimension as one row listing the values.
✅ <tr><th>Width</th><td>4.7"</td></tr>
   <tr><th>Projection from Wall</th><td>6.3"</td></tr>
   <tr><th>Height</th><td>Select your size: 11.8", 17.5", 23.5", 29.5", 39.5", or 47"</td></tr>

CASE B — TWO OR MORE dimensions vary together across sizes: use a SINGLE "Dimensions" row mapping each size to its full W × H × D. Do NOT also output separate Width / Height / Depth rows.
✅ <tr><th>Dimensions</th><td>Small: 4.3"W × 14.6"H × 3.3"D; Medium: 5.7"W × 18.3"H × 3.3"D; Large: 6.7"W × 22.2"H × 3.7"D</td></tr>

NEVER output BOTH a combined "Dimensions" row AND separate Width / Height / Depth rows — pick exactly one format. "Depth", "Projection from Wall", and "Distance from Wall" are the SAME measurement: include it once, never as two rows. DO NOT put a raw cm value in any dimension row label.

❌ BAD (combined row AND decoupled rows together; depth duplicated; cm in label):
<tr><th>Dimensions</th><td>Small: 4.3"W...</td></tr>
<tr><th>Width</th><td>4.3", 5.7", or 6.7"</td></tr>
<tr><th>Depth</th><td>3.3" or 3.7"</td></tr>
<tr><th>Projection from Wall</th><td>3.3" or 3.7"</td></tr>
<tr><th>Dimensions (30cm)</th><td>...</td></tr>

EXCEPTION — genuinely distinct named designs (e.g. "Round" vs "Square", or "Yunshi" vs "Jingyu") with different footprints: keep one "Dimensions (<design name>)" row per design.

NON-SELECTABLE OPTION PROPERTIES — consolidate, never per-option:

- If wattage / power / lumens / color temperature varies in the source but is NOT a live variant axis, present ONE row with a consolidated range. e.g. "Wattage: 10W–72W (varies by size)", "Color Temperature: 3000K–6000K".
- NEVER output a per-size or per-option breakdown like "30cm-10W, 30cm-20W, 45cm-12W…".

RECONCILE CONTRADICTIONS:

- If two source specs give different values for the SAME physical property (a standalone "Lamp Width" or "Distance from Wall" that disagrees with the variant dimensions; or "IP65" vs "IP55"), keep ONE value — the one consistent with the variant labels, otherwise the higher-confidence / more standard value. NEVER print two conflicting numbers for the same measurement.

DROP IMPLAUSIBLE / ERROR VALUES:

- Silently drop any spec whose value is physically impossible or an obvious scraping error — e.g. a large metal outdoor fixture listed as "Weight: 2 g" / "0.004 lb". Omit the row entirely rather than print a wrong value.

Include the genuinely useful customer-facing specs: material, finish, light source, color temperature, wattage (consolidated), IP / waterproof rating, input voltage, dimensions (as above), weight, coverage area, style, control type. ALWAYS include weight when the source provides one — present it per size when it varies (same size keys as the Dimensions row). Do NOT add specs not in the source.

🚨 OMIT THESE SPEC ROWS — STRICT (drop them silently, do NOT include any of these anywhere in the output — not in Specifications, not in What's Included, not in paragraphs, not in FAQ):

- Item Number / Item No / Item # / 编号
- Model Number / Model No / 型号 (the supplier's internal model code)
- Part Number / SKU / Article Number / Product ID / Supplier ID / 货号 / 订货号
- Certificate Number / Certification Number / Cert No (drop the bare ID; if the certification TYPE itself is customer-facing like "CE Certified" or "UL Listed", keep it as a value but never with the bare ID)
- Country of Origin / Made In / Manufacturer Location / 产地
- Brand / LED Chip Brand when it is an obscure supplier brand name, ESPECIALLY any value containing Chinese characters (e.g. "Yesepulan (夜瑟普蓝)") — drop the row entirely
- Cross-border export specific source / Main downstream platforms / Has patent / Imported / Patent / 跨境专供 / 主要下游平台 — and any other supplier-business attribute that isn't a product spec

These are supplier-internal identifiers and trade signals. The customer doesn't care, and surfacing them either reveals supplier origin or just clutters the table.

=== FAQ TAB ===

<h3>FAQ</h3>

3–4 practical product-related questions.

NO shipping or returns questions.

Each FAQ must follow this EXACT structure:

<p><strong>Question?</strong><br>Answer in plain text.</p>

🚨 STRICT FAQ FORMATTING RULE

ONLY the question is bold.

The answer MUST NOT be bold.

Keep question + answer in ONE <p> tag.

MUST use <br> between question and answer.

No extra tags inside <p>.

✅ Correct FAQ Example:

<p><strong>How do I adjust the band size?</strong><br>The stainless steel band can be resized by removing links with a small tool.</p>

🚨 UNITS RULES — STRICT (apply to EVERY section of the output)

NEVER write cm, mm, m (as length), m², 厘米, or any metric size/coverage unit anywhere in the output. All dimensions, sizes, lengths, widths, heights, depths, diameters, and coverage areas MUST be in US imperial units.

Conversion ratios (apply silently — do NOT show both units side-by-side):

- cm → inches: multiply by 0.394, round to 1 decimal. Examples: 30 cm → 11.8", 60 cm → 23.6", 100 cm → 39.4", 200 cm → 78.7".
- mm → inches: multiply by 0.0394, round to 1 decimal.
- m² → sq ft: multiply by 10.76, round to nearest whole. Example: "12-15 m²" → "130-160 sq ft".
- kg → lb: multiply by 2.205, round to 1 decimal.
- m (length, e.g. cable) → feet: multiply by 3.28, round to 1 decimal.

Format conventions:

- Lengths under 36": inches with a straight double-quote suffix. Example: 11.8" not "11.8 in".
- Lengths 36" and over: the Specifications table should keep the inch value with a feet equivalent in parentheses: "78.7" (6.6 ft)".
- Coverage area: always "sq ft" — never m².
- Multi-axis dimensions: keep the W × H × D layout — e.g. "23.6"W × 1.2"H × 2.0"D".

If a variant axis label uses cm in the source, translate it to inches in your output ("the 23.6" version" not "the 60 cm version").

STYLE RULES:

NEVER use em dashes. Use commas, periods, or colons instead.

No hype words: revolutionary, game-changing, incredible, amazing.

Be specific: include real measurements, materials, details. Avoid generic filler.

Total word count: 300–500 words.

SEO RULES:

Primary keyword in H2 heading. Primary keyword in first paragraph, within first 100 words. Include 3–5 related semantic keywords naturally. Keyword density 1–2%.

COMPLETENESS RULES:

Include all genuinely useful customer-facing specs from the source, AFTER applying the Variant Reconciliation, consolidation, contradiction, and drop rules above. Do NOT hallucinate features, specs, or included items. The What's Included section describes what's in the box once — never per variant.

✅ FINAL VALIDATION RULE, VERY IMPORTANT

The output is INVALID if:

- Any text after <br> is bold, or <strong> wraps more than the title/question.
- FAQ or Benefits use multiple <p> tags per entry, or the structure order is wrong.
- The output contains any of: cm, mm, m², 厘米, or a metric unit suffix.
- The What's Included block contains per-variant <strong>...</strong> sub-sections.
- The Specifications table contains a per-size dimensions row with the size in the label (e.g. "Dimensions (30cm)").
- The Specifications table contains a per-option breakdown for a property that is NOT a live variant axis (e.g. "30cm-10W, 30cm-20W…").
- The output prints two different values for the same physical measurement (e.g. both a 4.7" and a 6.3" width).
- The output prints an obviously implausible value (e.g. a steel fixture weighing 2 g / 0.004 lb).
- The output contains a Brand / chip-brand value with Chinese characters, or any forbidden supplier-internal identifier row (Item Number, Model Number, Part Number, SKU, Article Number, Certificate Number, Country of Origin, Made In).`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email: USER_EMAIL },
      select: { id: true, email: true },
    });
    if (!user) {
      console.error(`User ${USER_EMAIL} not found.`);
      process.exit(1);
    }

    const rule = await prisma.transformationRule.findFirst({
      where: { userId: user.id, category: "description", enabled: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, config: true },
    });
    if (!rule) {
      console.error(`No enabled description rule found for ${USER_EMAIL}.`);
      process.exit(1);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rule.config) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const prevModel = typeof parsed.model === "string" ? parsed.model : "(none)";
    parsed.prompt = DESCRIPTION_PROMPT;
    parsed.model = NEW_MODEL;

    await prisma.transformationRule.update({
      where: { id: rule.id },
      data: { config: JSON.stringify(parsed) },
    });

    console.log(`Updated description rule "${rule.name}" (${rule.id}) for ${user.email}`);
    console.log(`  model: ${prevModel} -> ${NEW_MODEL}`);
    console.log(`  prompt: variant-reconciled spec table + clean dimensions + drop contradictions/implausible/per-option`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
