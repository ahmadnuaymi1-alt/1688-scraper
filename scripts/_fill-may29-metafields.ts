/**
 * Generate custom.image_with_text_* + custom.faq_q{1-4} / faq_a{1-4} metafields
 * for the 9 products uploaded to Vilvida on 2026-05-29 and push them via
 * Shopify's metafieldsSet mutation. Style is reverse-engineered from the
 * 5/25 wall-sconce uploads (see scripts/_inspect-vilvida-metafields.ts output).
 *
 * Per product, Claude Sonnet receives the title + body_html + spec block and
 * returns a JSON object with 10 metafield string values. All 9 products fire
 * in parallel (Promise.all). The metafieldsSet mutation also fires in parallel
 * once all 9 generations complete.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { claudeText } from "../src/lib/ai/claude-client";

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

const PRODUCT_IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqhueh00amw2vsdewbgxhs",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqgin7004cw2vs04697sgd",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppv6kdl00rjw2vsnhsp6sqn",
  "cmppv892200t9w2vsh5vgmgmg",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

const prisma = new PrismaClient();

const STYLE_GUIDE = `You are generating Shopify metafield content for a luxury lighting brand (Vilvida).
Match the style of these REAL existing products on the same store:

Example product 1 — Fabric wall sconce (RGB, no-drill)
  image_with_text_header: "Light On the Wall, No Drill Required"
  image_with_text_body: "A fabric shade on a fabric-wrapped body softens the light the moment it leaves the bulb, giving even RGB color a gentle, room-warming feel. Strong 3M adhesive backs the fixture, so it goes up without anchors or patching, and the included remote handles tone, brightness, and color from across the room."
  faq_q1: "How does it mount without drilling?"
  faq_a1: "Strong 3M adhesive on the back plate holds the lamp directly against any smooth, clean wall — no anchors, no holes, no patching when you move it."
  faq_q2: "Can I change the light color and brightness?"
  faq_a2: "Yes. The included remote lets you switch between 3000K, 4500K, and 6500K white tones plus full RGB color, with brightness control on the same handset."
  faq_q3: "Which rooms is it best for?"
  faq_a3: "It is built for indoor use in living rooms, bedrooms, staircases, and family rooms — anywhere you want accent light without rewiring the wall."
  faq_q4: "Does it need professional wiring?"
  faq_a4: "No. The lamp runs cordlessly at low voltage and is operated by remote and touch switch, so a standard DIY install is all it takes."

Example product 2 — Acrylic concave wall sconce
  image_with_text_header: "Concave Glow, Quietly Modern"
  image_with_text_body: "A high-transparency acrylic lens sits in a brushed aluminum trim, casting a soft concave glow rather than a harsh point of light. The compact 5.5\\" × 3.1\\" profile keeps it visually quiet on corridor walls and bedside reading spots, and three-color dimming gives you warm, neutral, and cool tones from a single switch."
  faq_q1: "Can the lamp be dimmed?"
  faq_a1: "Yes. Three-color dimming is built in, controlled directly from the wall switch — no smart hub or extra dimmer module required."
  faq_q2: "Is it suitable for a bathroom?"
  faq_a2: "Yes. The fixture is rated for bathrooms as well as kitchens, corridors, and other indoor wet-adjacent areas like mirror zones and entries."
  faq_q3: "What is the lamp made of?"
  faq_a3: "An acrylic shade and body sit inside a brushed aluminum trim, giving the lamp a modern silhouette while keeping the weight down to roughly 1.5 lb."
  faq_q4: "Does mounting hardware come in the box?"
  faq_a4: "Yes. All the screws, anchors, and an installation guide ship with the fixture, so you can mount it the same day it arrives."

Style rules:
- HEADER: 4-7 words. Poetic but grounded — describe the visual or feel, not a feature list. Capitalise like a title.
- BODY: 50-80 words. ONE paragraph. Structure: open with material/design impression → reference at least one specific dimension/spec/finish → end with the lived-in use-case (which rooms, how it's controlled, what kind of moment).
- FAQs: exactly 4 buyer-practical questions. Typical themes across the four (vary the exact wording):
  - Q1: Controls / light source / bulbs included
  - Q2: Dimming, color temperature, brightness adjustment
  - Q3: Room suitability / use case / sizing
  - Q4: Installation, hardware in the box, mounting method
- ANSWERS: 1-3 sentences, factual, practical. Match the calm tone — no exclamation marks, no sales hype.
- Use straight quotes (not smart quotes). Use inch marks like 5.5" not 5.5″.
- Never invent specs that aren't in the product context. If the source is silent on dimming, frame the answer around what IS stated.

Return STRICT JSON. No markdown fences. No commentary. Exactly this shape:
{
  "image_with_text_header": "string",
  "image_with_text_body": "string",
  "faq_q1": "string",
  "faq_a1": "string",
  "faq_q2": "string",
  "faq_a2": "string",
  "faq_q3": "string",
  "faq_a3": "string",
  "faq_q4": "string",
  "faq_a4": "string"
}`;

interface MetafieldSet {
  image_with_text_header: string;
  image_with_text_body: string;
  faq_q1: string;
  faq_a1: string;
  faq_q2: string;
  faq_a2: string;
  faq_q3: string;
  faq_a3: string;
  faq_q4: string;
  faq_a4: string;
}

function parseMetafieldJson(raw: string): MetafieldSet {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s) as MetafieldSet;
  for (const k of [
    "image_with_text_header",
    "image_with_text_body",
    "faq_q1", "faq_a1", "faq_q2", "faq_a2", "faq_q3", "faq_a3", "faq_q4", "faq_a4",
  ] as const) {
    if (typeof parsed[k] !== "string" || !parsed[k].trim()) {
      throw new Error(`Missing or empty ${k} in JSON`);
    }
  }
  return parsed;
}

async function generateForProduct(productId: string): Promise<{
  productId: string;
  shopifyGid: string;
  metafields: MetafieldSet;
}> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: {
        where: { isHidden: false },
        select: { title: true, option1: true, option2: true, option3: true },
        take: 12,
      },
      uploads: {
        where: { status: "success" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { shopifyProductId: true },
      },
    },
  });
  if (!product) throw new Error(`product ${productId} not found`);
  const shopifyGid = product.uploads[0]?.shopifyProductId;
  if (!shopifyGid) throw new Error(`product ${productId} has no successful UploadRecord`);

  let extractedSpecs = "";
  if (product.productContext) {
    try {
      const ctx = JSON.parse(product.productContext) as {
        extractedSpecs?: Array<{ name?: string; value?: string }>;
      };
      if (Array.isArray(ctx.extractedSpecs)) {
        extractedSpecs = ctx.extractedSpecs
          .filter((s) => s && s.name && s.value)
          .map((s) => `  - ${s.name}: ${s.value}`)
          .join("\n");
      }
    } catch {
      // ignore
    }
  }

  const variantSummary = product.variants
    .map((v) => `  - ${[v.option1, v.option2, v.option3].filter(Boolean).join(" / ") || v.title}`)
    .join("\n");

  // Strip HTML tags for a cleaner Claude input.
  const plainBody = (product.descriptionHtml ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

  const userPrompt = `PRODUCT CONTEXT
Title: ${product.title}
Product type: ${product.productType ?? "(unspecified)"}
Option axes: ${product.optionNames ?? "[]"}

Description (HTML stripped):
${plainBody || "(no description)"}

Variants (${product.variants.length} visible):
${variantSummary}

Extracted specs:
${extractedSpecs || "(none)"}

Generate the 10 metafield values now. Return ONLY the JSON object.`;

  const raw = await claudeText({
    model: "claude-sonnet-4-6",
    system: STYLE_GUIDE,
    user: userPrompt,
    temperature: 0.4,
    maxTokens: 1500,
  });
  const metafields = parseMetafieldJson(raw);
  return { productId, shopifyGid, metafields };
}

interface ShopifyMetafieldInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

async function pushMetafields(
  storeDomain: string,
  token: string,
  ownerGid: string,
  mf: MetafieldSet,
): Promise<{ ok: boolean; errors: string[] }> {
  const fields: ShopifyMetafieldInput[] = [
    { ownerId: ownerGid, namespace: "custom", key: "image_with_text_header", type: "single_line_text_field", value: mf.image_with_text_header },
    { ownerId: ownerGid, namespace: "custom", key: "image_with_text_body", type: "multi_line_text_field", value: mf.image_with_text_body },
    { ownerId: ownerGid, namespace: "custom", key: "faq_q1", type: "single_line_text_field", value: mf.faq_q1 },
    { ownerId: ownerGid, namespace: "custom", key: "faq_a1", type: "multi_line_text_field", value: mf.faq_a1 },
    { ownerId: ownerGid, namespace: "custom", key: "faq_q2", type: "single_line_text_field", value: mf.faq_q2 },
    { ownerId: ownerGid, namespace: "custom", key: "faq_a2", type: "multi_line_text_field", value: mf.faq_a2 },
    // Note: store schema defines faq_q3 as multi_line_text_field (not single_line). Matching their schema.
    { ownerId: ownerGid, namespace: "custom", key: "faq_q3", type: "multi_line_text_field", value: mf.faq_q3 },
    { ownerId: ownerGid, namespace: "custom", key: "faq_a3", type: "multi_line_text_field", value: mf.faq_a3 },
    { ownerId: ownerGid, namespace: "custom", key: "faq_q4", type: "single_line_text_field", value: mf.faq_q4 },
    { ownerId: ownerGid, namespace: "custom", key: "faq_a4", type: "multi_line_text_field", value: mf.faq_a4 },
  ];
  const SET_QUERY = `
    mutation setMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `;
  const url = `https://${storeDomain}/admin/api/2024-10/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: SET_QUERY, variables: { metafields: fields } }),
  });
  if (!res.ok) {
    return { ok: false, errors: [`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`] };
  }
  const body = (await res.json()) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ field?: string[]; message?: string }> } };
    errors?: Array<{ message?: string }>;
  };
  if (body.errors && body.errors.length > 0) {
    return { ok: false, errors: body.errors.map((e) => e.message ?? "?") };
  }
  const ue = body.data?.metafieldsSet?.userErrors ?? [];
  if (ue.length > 0) {
    return { ok: false, errors: ue.map((e) => `${(e.field ?? []).join(".")}: ${e.message ?? "?"}`) };
  }
  return { ok: true, errors: [] };
}

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`;
}

(async () => {
  const conn = await prisma.shopifyConnection.findFirst({ where: { label: "Vilvida" } });
  if (!conn) {
    console.error("No Vilvida connection");
    process.exit(1);
  }

  const t0 = Date.now();
  console.log(`Generating metafields for ${PRODUCT_IDS.length} product(s) in parallel...\n`);
  const generated = await Promise.all(
    PRODUCT_IDS.map(async (id) => {
      const tStart = Date.now();
      try {
        const r = await generateForProduct(id);
        console.log(`  GEN OK  ${id}  → ${r.shopifyGid}  (${fmt(Date.now() - tStart)})`);
        console.log(`    header: ${r.metafields.image_with_text_header}`);
        return r;
      } catch (err) {
        console.error(`  GEN FAIL  ${id}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }),
  );
  const ok = generated.filter((g): g is NonNullable<typeof g> => !!g);
  console.log(`\nGenerated ${ok.length}/${PRODUCT_IDS.length}. Pushing to Shopify in parallel...\n`);

  const pushed = await Promise.all(
    ok.map(async (g) => {
      const tStart = Date.now();
      const r = await pushMetafields(conn.storeDomain, conn.accessToken, g.shopifyGid, g.metafields);
      const elapsed = fmt(Date.now() - tStart);
      if (r.ok) {
        console.log(`  PUSH OK  ${g.productId}  (${elapsed})`);
      } else {
        console.log(`  PUSH FAIL  ${g.productId}  (${elapsed}): ${r.errors.join("; ")}`);
      }
      return { productId: g.productId, ok: r.ok, errors: r.errors };
    }),
  );

  const pushOk = pushed.filter((p) => p.ok).length;
  console.log(`\n=== Done in ${fmt(Date.now() - t0)}: generated ${ok.length}/${PRODUCT_IDS.length}, pushed ${pushOk}/${ok.length} ===`);
  await prisma.$disconnect();
})();
