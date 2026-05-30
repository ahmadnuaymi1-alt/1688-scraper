/**
 * One-shot rule update:
 *   - Rewrites the long title rule (cmp307yrd002ew2o4j0z773yb) so titles
 *     LEAD with a distinguishing physical attribute (material/finish + form),
 *     not with "Modern Minimalist". A leading style modifier becomes optional
 *     and bans "Modern / Minimalist / Contemporary / Nordic / Scandinavian" as
 *     the first word — those describe 80% of the catalog and add zero
 *     differentiation per the title research (Visual Comfort, Schoolhouse,
 *     Cedar & Moss, Pottery Barn, etc. — none lead with a style adjective).
 *   - Disables the redundant short title rule (cmp2xh2qg0001w2o4lmezuj05),
 *     which is now strictly a worse version of the long one.
 *
 * Use --dry-run to print the planned changes without writing.
 *
 *   npx tsx scripts/_update-title-rule.ts [--dry-run]
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

const LONG_RULE_ID = "cmp307yrd002ew2o4j0z773yb";
const SHORT_RULE_ID = "cmp2xh2qg0001w2o4lmezuj05";

const NEW_TITLE_PROMPT = `TITLE RULES, STRICT

You are an expert in eCommerce SEO, Google Shopping feed optimization, and lighting-category keyword research.

Your task is to generate ONE high-performing, Google Merchant Center-compliant product title using a keyword-stacked descriptive format. No individual product names, no brand names, no pipe separators.

IMPORTANT CONTEXT:

The store name must NEVER appear in the title.

You must NEVER invent an individual product name, model name, collection name, or designer-style word (no Nala, Aurelia, Lumière, Wren, Cloud, Bloom, Stem, Capa, Linnea, etc.).

The store IS the brand. Every product is described in pure descriptive attributes only. This is the Bulbsquare.com pattern, keyword-stacked SEO with no individual product names.

TITLE STRUCTURE, MANDATORY:

[Material / Color / Finish] [Form / Shape Feature] [Tech Feature] [optional Light Count] [Specific Product Type]

A LEADING STYLE MODIFIER is OPTIONAL. Use ONE only when the product is genuinely that style and the word actually differentiates this product from the rest of the catalog. Allowed leading styles: Japandi, Vintage, Industrial, Mid-Century, Art Deco, Bohemian, Coastal, Farmhouse.

🚨 LEADING-WORD BAN — STRICT:

NEVER start a title with: Modern, Minimalist, Contemporary, Nordic, Scandinavian.

Why: these words describe roughly 80% of the catalog, so they add zero differentiation, waste the highest-CTR slot in the title, and create "title fatigue" where every grid tile starts with the same two words and shoppers' eyes skip past them. They are also the first-position pattern that Google's spam filters flag as keyword stuffing across a feed.

NEVER stack two style adjectives in the lead position (no "Modern Minimalist", no "Modern Contemporary", no "Nordic Scandinavian", etc.).

Examples of correct output (lead with the differentiating PHYSICAL attribute, not style):

Pleated Rice Paper Cordless LED Bedside Table Lamp
Matte Glass Mushroom 1-Light Table Lamp
Cordless Aluminum Dimmable LED Wall Sconce
Aged Brass Tiered 1-Light Pendant Lamp
Solid Oak Acrylic Diffuser LED Flush Mount Ceiling Light
Smoked Glass Globe Brass 3-Light Pendant Cluster
Vintage Aged Brass Tiered 1-Light Pendant Lamp        (leading style word OK — Vintage genuinely differentiates)
Japandi Pleated Rice Paper Cordless LED Bedside Lamp  (leading style word OK — Japandi genuinely differentiates)

Counter-examples (DO NOT OUTPUT):

❌ Modern Pleated Rice Paper Cordless LED Bedside Lamp   (DROP "Modern" — adds no differentiation)
❌ Minimalist Aluminum Dimmable LED Wall Sconce           (DROP "Minimalist" — adds no differentiation)
❌ Modern Minimalist Iron LED Desk Lamp                   (DOUBLE-LEAD ban + both are banned lead words)
❌ Contemporary Aged Brass Pendant                        (DROP "Contemporary")
❌ Nordic Matte Glass Mushroom Lamp                       (DROP "Nordic")
❌ Modern Italian Walnut Wood Aluminum Adjustable LED     (DROP "Modern" — start with "Walnut Wood")

RULES, DO NOT BREAK:

Target length 55–75 characters. Push toward 65. Hard maximum 85.

NO pipe | separator. NO comma between attribute words. NO em dash. NO colon.

NO individual product name, model name, collection name, or atmospheric single-word identifier at the front.

NO store name anywhere.

LEAD with the differentiating physical attribute (material + form). Style modifier is optional and conditional (see above) — never automatic, never a default opener, and NEVER one of the banned lead words.

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

Style modifiers (OPTIONAL leading word — max 1, ONLY when distinctively appropriate):
Japandi, Vintage, Industrial, Mid-Century, Art Deco, Bohemian, Coastal, Farmhouse

🚨 BANNED as leading words (still allowed as collection tags, never as the title's first word):
Modern, Minimalist, Contemporary, Nordic, Scandinavian

Materials as nouns:
Rice Paper, Linen, Cotton, Silk, Brass, Aged Brass, Glass, Smoked Glass, Frosted Glass, Rattan, Wicker, Walnut, Oak, Solid Oak, Acacia, Wood, Aluminum, Steel, Iron, Ceramic, Porcelain, Concrete, PVC, Acrylic, Resin, Marble, Alabaster

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

Pick attributes a buyer would actually type into Google. If an attribute doesn't earn search volume or buyer intent, drop it. "Modern" is a Google-zero word for lighting — buyers searching "modern brass pendant" are really searching "brass pendant" with one filler word.

Lead with the SINGLE most differentiating physical attribute the product has. If it's a brass globe pendant, lead "Brass Globe". If it's a pleated rice paper bedside lamp, lead "Pleated Rice Paper". The opener earns the click.

Read the result aloud. It should sound like a clean catalog descriptor that opens with a unique physical attribute, not a marketing tagline.

OUTPUT:

Return ONLY the product title.

No explanations.

No bullet points.

No extra text.`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  const long = await prisma.transformationRule.findUnique({ where: { id: LONG_RULE_ID } });
  const short = await prisma.transformationRule.findUnique({ where: { id: SHORT_RULE_ID } });

  if (!long) {
    process.stderr.write(`Long rule ${LONG_RULE_ID} not found.\n`);
    process.exit(1);
  }
  if (!short) {
    process.stderr.write(`Short rule ${SHORT_RULE_ID} not found.\n`);
    process.exit(1);
  }

  // Parse the current config so we keep its model setting.
  let cfg: { prompt?: string; model?: string } = {};
  try { cfg = JSON.parse(long.config); } catch { cfg = {}; }
  const newConfig = JSON.stringify({
    model: cfg.model ?? "gpt-4.1-mini",
    prompt: NEW_TITLE_PROMPT,
  });

  process.stdout.write(`Long rule ${LONG_RULE_ID}:\n`);
  process.stdout.write(`  current config length: ${long.config.length}\n`);
  process.stdout.write(`  new config length:     ${newConfig.length}\n`);
  process.stdout.write(`  enabled: ${long.enabled} (no change)\n\n`);

  process.stdout.write(`Short rule ${SHORT_RULE_ID}:\n`);
  process.stdout.write(`  currently enabled: ${short.enabled}\n`);
  process.stdout.write(`  will set enabled = false (redundant with long rule)\n\n`);

  if (dryRun) {
    process.stdout.write(`(dry-run — no DB writes)\n`);
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction([
    prisma.transformationRule.update({
      where: { id: LONG_RULE_ID },
      data: { config: newConfig },
    }),
    prisma.transformationRule.update({
      where: { id: SHORT_RULE_ID },
      data: { enabled: false },
    }),
  ]);
  process.stdout.write(`✓ Long rule prompt updated.\n`);
  process.stdout.write(`✓ Short rule disabled.\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
