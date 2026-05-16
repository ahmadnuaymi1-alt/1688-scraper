/**
 * One-off: replace the `prompt` field on the user's TransformationRule for
 * each of the 5 categories (description, title, seo, tags, image). The
 * existing `model` choice is preserved. Runs atomically inside a single
 * prisma.$transaction — either all 5 update or none do.
 *
 * Targets the user `aldillamiw1@gmail.com` (project memory). If they ever
 * have multiple enabled rules in a category, the most-recently-updated one
 * wins (logged so you can see which got picked).
 *
 * Usage:  npx tsx scripts/_update-user-rules.ts
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const USER_EMAIL = "ahmadnuaymi1@gmail.com";
const DEFAULT_MODEL = "gpt-4.1-mini";
const CATEGORY_DEFAULT_NAME: Record<string, string> = {
  description: "Standard description",
  title: "Standard product title",
  seo: "Standard SEO description",
  tags: "Standard tags",
  image: "Image filename + alt text",
};

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

If multiple configurations exist:

<p><strong>[Option Name]</strong></p>

<ul> list for each option

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

Use a table and include ALL specs from the source:

<table>
<tr><th>Spec Name</th><td>Spec Value</td></tr>
</table>

Include dimensions, materials, weight, power, etc.

Do NOT skip any specs.

Do NOT add specs not in the source.

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

The What's Included section must match the product exactly.

If multiple configurations exist, list each separately.

✅ FINAL VALIDATION RULE, VERY IMPORTANT

The output is INVALID if:

Any text after <br> is bold.

<strong> wraps more than the title/question.

FAQ or Benefits use multiple <p> tags per entry.

Structure order is incorrect.`;

const TITLE_PROMPT = `TITLE RULES, STRICT

You are an expert in eCommerce SEO, Google Shopping feed optimization, and lighting-category keyword research.

Your task is to generate ONE high-performing, Google Merchant Center-compliant product title using a keyword-stacked descriptive format. No individual product names, no brand names, no pipe separators.

IMPORTANT CONTEXT:

The store name must NEVER appear in the title.

You must NEVER invent an individual product name, model name, collection name, or designer-style word (no Nala, Aurelia, Lumière, Wren, Cloud, Bloom, Stem, Capa, Linnea, etc.).

The store IS the brand. Every product is described in pure descriptive attributes only. This is the Bulbsquare.com pattern, keyword-stacked SEO with no individual product names.

TITLE STRUCTURE, MANDATORY:

[Style Modifier 1] [optional Style Modifier 2] [Material / Color / Form] [Tech Feature] [optional Light Count] [Specific Product Type]

Examples of correct output:

Japandi Pleated Rice Paper Cordless LED Bedside Table Lamp
Nordic Matte Glass Mushroom 1-Light Table Lamp
Modern Cordless Aluminum Dimmable LED Wall Sconce Lamp
Vintage Industrial Aged Brass 1-Light Pendant Lamp
Modern Solid Oak Acrylic Diffuser LED Flush Mount Ceiling Light
RULES, DO NOT BREAK:

Target length 55–75 characters. Push toward 65. Hard maximum 85.

NO pipe | separator. NO comma between attribute words. NO em dash. NO colon.

NO individual product name, model name, collection name, or atmospheric single-word identifier at the front.

NO store name anywhere.

Stack 2 style modifiers + 2 tech features + light count ONLY when they genuinely apply to the product. Do not pad with attributes that don't fit.

Capitalize each significant word (title case). No ALL CAPS except acronyms (LED, USB-C, RGB, IP65).

Use only factual attributes drawn from the product, material, color, form, finish, tech feature, light count, product type.

Specific product type must bundle room intent (write "Bedside Lamp" not "Table Lamp for Bedroom"; write "Desk Lamp" not "Office Lamp").

NO room phrases ("for Bedroom", "for Living Room", "for Kitchen").

NO benefit clauses ("creates ambiance", "perfect for", "ideal for", "designed to").

NO filler adjectives (Elegant, Beautiful, Premium, Stunning, Cozy, Gorgeous, Luxurious, Lovely).

NO compound vibe-mashups (Celestial Glow, Cherry Blossom Dream, Luxe Mirage).

NO suffix vibe-words used as product names (Glow, Aura, Luxe, Bliss, Haven).

NO promotional language (sale, best, free, discount, new).

NO trademarked brand names.

NO percentages or numeric qualifiers (e.g. 100%). Describe materials plainly.

NO quantity or set size ranges (7-piece, 8-piece, 12-piece).

NO color lists or multiple colors stacked together.

NO packaging, shipping, or warranty details.

NO emojis, NO ™, NO ®.

APPROVED VOCABULARY:

Style modifiers (1 primary, max 2 stacked):
Modern, Nordic, Scandinavian, Japandi, Minimalist, Contemporary, Vintage, Industrial, Mid-Century, Art Deco, Bohemian, Coastal, Farmhouse

Materials as nouns:
Rice Paper, Linen, Cotton, Silk, Brass, Glass, Smoked Glass, Frosted Glass, Rattan, Wicker, Walnut, Oak, Solid Oak, Acacia, Wood, Aluminum, Steel, Iron, Ceramic, Porcelain, Concrete, PVC, Acrylic, Resin, Marble, Alabaster

Form / color descriptors:
Round, Rectangular, Spherical, Globe, Drum, Cone, Mushroom, Tripod, Linear, Arched, Bracket, Pleated, Faceted, Folded, Tiered, Cascading, Cluster, Matte, Aged, Antique, Brushed, Polished, Smoked, Frosted

Tech features:
LED, Dimmable LED, Cordless, USB-C Rechargeable, Solar, Motion-Sensor, Smart, Touch-Control, Adjustable, Eye-Care, RGB, 3-Color Temperature

Light count:
1-Light, 2-Light, 3-Light, 6-Light, 8-Light

Specific product types (room intent already bundled in):
Bedside Lamp, Desk Lamp, Reading Lamp, Nightstand Lamp, Wall Sconce, Bracket Wall Sconce, Outdoor Wall Sconce, Pendant Light, Pendant Lamp, Cluster Pendant, Flush Mount Ceiling Light, Semi-Flush Mount Ceiling Light, Floor Lamp, Tripod Floor Lamp, Arc Floor Lamp, Chandelier, Linear Chandelier, Under-Cabinet Light, Stair Light, Picture Light

GUIDANCE:

The 80/20 split is 80% SEO, 20% luxury. Push for keyword density first; the luxury feel comes from what's ABSENT (no fluff, no fake-European names, no pipe), not from what's added.

Pick attributes that a buyer would actually type into Google. If an attribute doesn't earn search volume or buyer intent, drop it.

Read the result aloud. It should sound like a clean catalog descriptor, not a marketing tagline.

OUTPUT:

Return ONLY the product title.

No explanations.

No bullet points.

No extra text.`;

const SEO_PROMPT = `Summarize the product and its most important features in less than 160 characters.`;

const TAGS_PROMPT = `TAGS RULES, STRICT

Output exactly 10 tags in array field tags.

Tags must be unique, case-insensitive.

Each tag must be 1–3 words.

Tags should be broad and collection-friendly, but still relevant to the product context.

Make the tags SEO-focused.

Prefer category, use-case, style, material, and feature tags.

The tags will ideally be used to create collections, so keep that in mind.

Avoid filler or promotional tags.

Never output ai_pending or ai_done.

Example tags:

Table Lamp

USB Rechargeable Lamp

Touch Control Lamp

Sleek Lamp Design

Portable Lighting

Modern Table Lamp

LED Table Lamp

Eco-Friendly Lamp

Cordless Table Lamp

Ambiance Lighting`;

const IMAGE_PROMPT = `rename all image files using this:

Product-Name-description

where:

"Product-Name" is formatted with capital letters and hyphens instead of spaces.

"description" is in lowercase with hyphens for spaces.

For the description part of the file, create descriptions for each image based on what is shown.

If there is ever a time where the title has " for inches or ' for feet, replace them with the words inch or feet.

Replace:

" → inch

' → feet

Example:

13" to 55" → 13-inch-to-55-inch

Length:

Ideal filename length: 50–80 characters

Max: 100 characters

If too long, shorten the description, not the product name.

Remove filler words like:

with, and, the, for

Ensure filenames stay clear and readable.

The alt text should be the same as the file name but without the dashes.

Also, if the file name is truncated or made shorter, then the alt text description section can be slightly longer.`;

const CATEGORY_PROMPTS: Record<string, string> = {
  description: DESCRIPTION_PROMPT,
  title: TITLE_PROMPT,
  seo: SEO_PROMPT,
  tags: TAGS_PROMPT,
  image: IMAGE_PROMPT,
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email: USER_EMAIL },
      select: { id: true, email: true },
    });
    if (!user) {
      console.error(`User ${USER_EMAIL} not found in DB`);
      process.exit(1);
    }
    console.log(`User: ${user.email} (${user.id})`);

    // For each category: either update the existing rule, or create a new one
    // if none exists (e.g. user never set up SEO).
    const toUpdate: Array<{ category: string; ruleId: string; newConfig: string }> = [];
    const toCreate: Array<{ category: string; name: string; config: string }> = [];

    for (const category of Object.keys(CATEGORY_PROMPTS)) {
      const rule = await prisma.transformationRule.findFirst({
        where: { userId: user.id, category, enabled: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, config: true },
      });
      if (rule) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(rule.config) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
        parsed.prompt = CATEGORY_PROMPTS[category];
        if (!parsed.model) parsed.model = DEFAULT_MODEL;
        toUpdate.push({
          category,
          ruleId: rule.id,
          newConfig: JSON.stringify(parsed),
        });
        console.log(`  ${category.padEnd(12)} update → ${rule.id}  "${rule.name}"`);
      } else {
        const cfg = JSON.stringify({
          prompt: CATEGORY_PROMPTS[category],
          model: DEFAULT_MODEL,
        });
        toCreate.push({
          category,
          name: CATEGORY_DEFAULT_NAME[category] ?? `Standard ${category}`,
          config: cfg,
        });
        console.log(`  ${category.padEnd(12)} create (no existing rule)`);
      }
    }

    if (toUpdate.length === 0 && toCreate.length === 0) {
      console.log("\nNothing to do.");
      return;
    }

    console.log(
      `\nApplying ${toUpdate.length} update(s) + ${toCreate.length} create(s) in one transaction...`,
    );
    await prisma.$transaction([
      ...toUpdate.map((u) =>
        prisma.transformationRule.update({
          where: { id: u.ruleId },
          data: { config: u.newConfig },
        }),
      ),
      ...toCreate.map((c) =>
        prisma.transformationRule.create({
          data: {
            userId: user.id,
            category: c.category,
            name: c.name,
            config: c.config,
            enabled: true,
          },
        }),
      ),
    ]);

    const allCats = [
      ...toUpdate.map((u) => u.category),
      ...toCreate.map((c) => `${c.category} (new)`),
    ];
    console.log(`\n✓ Done: ${allCats.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
