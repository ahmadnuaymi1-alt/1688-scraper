/**
 * Update the user's enabled description-category TransformationRule to:
 *   1. Make "What's Included" a SINGLE flat list — no per-variant sub-sections
 *   2. Forbid metric units (cm / mm / m / m²) anywhere in output; convert to
 *      inches / feet / sq ft via the standard ratios (cm × 0.394, m² × 10.76).
 *   3. Forbid supplier-internal identifier rows in Specifications: Item Number,
 *      Model Number, Part Number, SKU, Article Number, Certificate Number, etc.
 *
 * Mirrors the patch shape of `_update-user-rules.ts` but only touches the
 * description rule. Runs against the user matched by USER_EMAIL.
 *
 *   npx tsx scripts/_update-description-rule-no-cm-no-pervariant.ts
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

const DESCRIPTION_PROMPT = `Output ONLY valid HTML. Rewrite in your own words.

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

If different variants ship slightly different things (e.g. some have a remote, some don't), describe the contents generically ("ceiling light fixture, length/size as selected") and let the variant selector handle the specifics. ONE bullet per box-content item, maximum 5 bullets.

✅ Correct What's Included:

<p><strong>What's Included</strong></p>
<ul>
  <li>Ceiling light fixture (size as selected)</li>
  <li>Remote control for brightness and color temperature</li>
  <li>Mounting hardware and installation guide</li>
</ul>

❌ Incorrect What's Included (DO NOT EVER OUTPUT THIS PATTERN):

<p><strong>What's Included</strong></p>
<ul><li>Ceiling light fixture</li>...</ul>
<p><strong>23.6" Variant</strong></p>
<ul><li>Dimensions: 23.6"W × 1.2"H × 2.0"D</li><li>Power: 12W</li>...</ul>
<p><strong>31.5" Variant</strong></p>
<ul>...</ul>

The above per-variant pattern is FORBIDDEN. Variant-specific dimensions, wattage, and coverage belong in the Specifications table only.

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

Use a table and include ALL customer-facing specs from the source:

<table>
<tr><th>Spec Name</th><td>Spec Value</td></tr>
</table>

Include dimensions, materials, weight, power, light source, voltage, color temperature, coverage area, etc.

Do NOT add specs not in the source.

🚨 OMIT THESE SPEC ROWS — STRICT (drop them silently, do NOT include any of these anywhere in the output — not in Specifications, not in What's Included, not in paragraphs, not in FAQ):

- Item Number / Item No / Item # / 编号
- Model Number / Model No / Model # / 型号 (the supplier's internal model code — drop)
- Part Number / Part No
- SKU / Article Number / Product ID / Supplier ID / 货号
- Certificate Number / Certification Number / Cert No (long supplier certification IDs like "2024371001000354" — drop the number; if the certification TYPE itself is customer-facing like "CE Certified" or "UL Listed", keep it as a value but never with the bare ID)
- Country of Origin / Made In / Manufacturer Location / 产地 (already covered by the Hide China rule, restated here for emphasis)
- Cross-border export specific source / Main downstream platforms / Has patent / 跨境专供 / 主要下游平台 / and any other supplier-business attribute that isn't a product spec

These are supplier-internal identifiers and trade signals. The customer doesn't care, and surfacing them either reveals supplier origin or just clutters the table. If you see them in the source extractedSpecs, silently drop them — no substitute, no placeholder.

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

❌ Incorrect FAQ Examples:

<p><strong>How do I adjust the band size?<br>The stainless steel band can be resized by removing links with a small tool.</strong></p>

<p><strong>How do I adjust the band size?</strong><br><strong>The stainless steel band can be resized by removing links with a small tool.</strong></p>

🚨 UNITS RULES — STRICT (apply to EVERY section of the output)

NEVER write cm, mm, m (as length), m², 厘米, or any metric size/coverage unit anywhere in the output — not in headings, paragraphs, What's Included, Benefits, Specifications table, or FAQ. All dimensions, sizes, lengths, widths, heights, depths, diameters, and coverage areas MUST be in US imperial units.

Conversion ratios (apply silently — do NOT show both units side-by-side):

- cm → inches: multiply by 0.394, round to 1 decimal. Examples: 30 cm → 11.8", 60 cm → 23.6", 100 cm → 39.4", 200 cm → 78.7".
- mm → inches: multiply by 0.0394, round to 1 decimal.
- m² → sq ft: multiply by 10.76, round to nearest whole. Example: "12-15 m² illumination area" → "130-160 sq ft illumination area".
- kg → lb: multiply by 2.205, round to 1 decimal.
- m (length, e.g. cable length) → feet: multiply by 3.28, round to 1 decimal. e.g. 1.5 m cable → 4.9 ft cable.

Format conventions:

- Lengths under 36": always inches with a straight double-quote suffix ("12.6\\""). Example: 11.8" not "11.8 in".
- Lengths 36" and over: feel free to use feet for marketing copy ("6.6 ft strip"), but the Specifications table should keep the inch value with a feet equivalent in parentheses for clarity: "78.7" (6.6 ft)".
- Coverage area: always "sq ft" or "ft²" — never m².
- Multi-axis dimensions: keep the existing W × H × D layout — e.g. "23.6"W × 1.2"H × 2.0"D".

If the source product context describes a variant axis using cm (e.g. supplier called it "60 cm Length"), translate it into inches in your output: write "the 23.6" version" not "the 60 cm version". If a variant axis label itself contains cm in the source data, treat the customer-facing label as the inch equivalent.

STYLE RULES:

NEVER use em dashes. Use commas, periods, or colons instead.

No hype words: revolutionary, game-changing, incredible, amazing.

Be specific: include measurements, materials, real details.

Avoid generic filler text.

Total word count: 300–500 words.

SEO RULES:

Primary keyword in H2 heading.

Primary keyword in first paragraph, within first 100 words.

Include 3–5 related semantic keywords naturally.

Keyword density: 1–2%, never exceed 2–3%.

COMPLETENESS RULES:

Include ALL specifications from the source.

Do NOT hallucinate features, specs, or included items.

The What's Included section must describe what's in the box once — never per variant.

✅ FINAL VALIDATION RULE, VERY IMPORTANT

The output is INVALID if:

Any text after <br> is bold.

<strong> wraps more than the title/question.

FAQ or Benefits use multiple <p> tags per entry.

Structure order is incorrect.

The output contains any of: cm, mm, m², 厘米, metric unit suffix.

The output contains per-variant <strong>...</strong> sub-section blocks under What's Included.

The output contains any forbidden supplier-internal identifier row: Item Number, Model Number, Part Number, SKU, Article Number, Certificate Number, Country of Origin, Made In, or their Chinese equivalents.`;

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
    parsed.prompt = DESCRIPTION_PROMPT;
    if (!parsed.model) parsed.model = "gpt-4.1-mini";

    await prisma.transformationRule.update({
      where: { id: rule.id },
      data: { config: JSON.stringify(parsed) },
    });

    console.log(`Updated description rule "${rule.name}" (${rule.id}) for ${user.email}`);
    console.log(`  - "What's Included" is now a SINGLE flat list (no per-variant sub-sections)`);
    console.log(`  - Metric units (cm / mm / m² / 厘米) forbidden everywhere in output`);
    console.log(`  - Supplier-internal identifiers (Item Number, Model Number, SKU, Certificate Number, etc.) forbidden in Specifications`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
