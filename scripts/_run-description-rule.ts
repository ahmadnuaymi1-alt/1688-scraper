/**
 * Run the user's enabled "description" TransformationRule against ONE product
 * and write the result to Product.descriptionHtml. Mirrors the production
 * applyDescriptionRules() path in src/services/rule.service.ts (same product
 * context block, same live-variant block, same required-sections trailer) but
 * isolated to one product and using relative imports so it runs cleanly under
 * tsx. Picks up whatever prompt + model the rule currently has in the DB.
 *
 *   npx tsx scripts/_run-description-rule.ts <productId> [--dry]
 *
 * --dry prints the generated HTML but does NOT write to the DB.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { openaiText, isOpenAIConfigured } from "../src/lib/ai/openai-client";
import { claudeText, isClaudeConfigured } from "../src/lib/ai/claude-client";

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
const DEFAULT_RULE_MODEL = "gpt-4.1-mini";

// --- copied verbatim from rule.service.ts so this mirrors production ---

function buildProductContextBlock(p: {
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string | null;
  descriptionHtml: string | null;
  optionNames: string | null;
  productContext: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`Title: ${p.title}`);
  if (p.vendor) parts.push(`Vendor: ${p.vendor}`);
  if (p.productType) parts.push(`Product Type: ${p.productType}`);
  if (p.tags) parts.push(`Tags: ${p.tags}`);
  if (p.optionNames) {
    try {
      const arr = JSON.parse(p.optionNames);
      if (Array.isArray(arr) && arr.length > 0) parts.push(`Variant axes: ${arr.join(" / ")}`);
    } catch { /* ignore */ }
  }
  if (p.productContext) {
    try {
      const ctx = JSON.parse(p.productContext) as {
        extractedSpecs?: Array<{ name: string; value: string }>;
        featureCallouts?: string[];
      };
      if (Array.isArray(ctx.extractedSpecs) && ctx.extractedSpecs.length > 0) {
        const specLines = ctx.extractedSpecs.slice(0, 60).map((s) => `  - ${s.name}: ${s.value}`).join("\n");
        parts.push(`Specifications:\n${specLines}`);
      }
      if (Array.isArray(ctx.featureCallouts) && ctx.featureCallouts.length > 0) {
        parts.push(`Feature callouts:\n${ctx.featureCallouts.map((f) => `  - ${f}`).join("\n")}`);
      }
    } catch { /* ignore */ }
  }
  if (p.descriptionHtml) {
    const text = p.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) parts.push(`Description summary (first 800 chars):\n${text.slice(0, 800)}`);
  }
  return parts.join("\n\n");
}

function formatLiveVariantsForPrompt(
  variants: Array<{ option1: string | null; option2: string | null; option3: string | null; price: string }>,
): string {
  if (variants.length === 0) return "Available variants: (none — single SKU)";
  const lines = variants.map((v, i) => {
    const opts = [v.option1, v.option2, v.option3].filter((s): s is string => !!s && s.trim().length > 0).join(" / ");
    return `  ${i + 1}. ${opts || "(default)"} — $${v.price}`;
  });
  return `Available variants (${variants.length} live SKU${variants.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}

function chooseProvider(model?: string): "openai" | "claude" {
  if (!model) return "openai";
  if (model.startsWith("claude-")) return "claude";
  return "openai";
}

async function main() {
  const productId = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!productId) { console.error("Usage: tsx scripts/_run-description-rule.ts <productId> [--dry]"); process.exit(1); }
  const prisma = new PrismaClient();

  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL }, select: { id: true } });
  const rule = await prisma.transformationRule.findFirst({
    where: { userId: user?.id, category: "description", enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { name: true, config: true },
  });
  if (!rule) { console.error("No enabled description rule"); process.exit(1); }
  const cfg = JSON.parse(rule.config) as { prompt: string; model?: string };
  const model = cfg.model || DEFAULT_RULE_MODEL;
  const provider = chooseProvider(model);
  console.log(`Rule: "${rule.name}"  model=${model}  provider=${provider}`);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, vendor: true, productType: true, tags: true, descriptionHtml: true, optionNames: true, productContext: true },
  });
  if (!product) { console.error("Product not found"); process.exit(1); }

  const liveVariants = await prisma.variant.findMany({
    where: { productId, isHidden: false },
    orderBy: { position: "asc" },
    select: { option1: true, option2: true, option3: true, price: true },
  });
  const variantBlock = formatLiveVariantsForPrompt(liveVariants);

  const userMessage = `${cfg.prompt}

Product context:
${buildProductContextBlock(product)}

${variantBlock}

CRITICAL: The description must describe ONLY the variants in the "Available variants" list above. Do NOT mention features, options, sizes, modes, or finishes that aren't represented in that list (e.g. if a charging mode, size, or color was curated out, do NOT describe it). The customer can ONLY buy what's listed.

REQUIRED SECTIONS — your output MUST include EVERY ONE of these, in this exact order, even if you have to be brief in places:
  1. The H2 product-type heading + three paragraphs + the "What's Included" block (per the rule's === DESCRIPTION TAB === section).
  2. <h3>Benefits</h3> with 3–5 benefit entries in the strict <p><strong>Title</strong><br>plain-text sentence</p> format.
  3. <h3>Specifications</h3> with a <table> of clean, customer-facing specs, reconciled to the live variants per the rule above (consolidate per-size rows, drop contradictory/implausible values).
  4. <h3>FAQ</h3> with 3–4 entries in the strict <p><strong>Question?</strong><br>plain-text answer</p> format.

Before responding, re-read the rule above and confirm all four sections are present in your output. The output is INVALID if any section is missing.

Return ONLY the new descriptionHtml as defined by the rule above. No <html>/<body> wrapper, no markdown fences, no commentary.`;

  if (provider === "openai" && !isOpenAIConfigured()) { console.error("OPENAI_API_KEY not set"); process.exit(1); }
  if (provider === "claude" && !isClaudeConfigured()) { console.error("ANTHROPIC_API_KEY not set"); process.exit(1); }

  console.log(`Sending ${userMessage.length} chars to ${provider} (${model})...`);
  const t0 = Date.now();
  const newHtml = (
    provider === "openai"
      ? await openaiText({ model, user: userMessage, maxTokens: 8192, temperature: 0.5 })
      : await claudeText({ model, user: userMessage, maxTokens: 8192, temperature: 0.5 })
  ).trim();
  console.log(`Got ${newHtml.length} chars in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  console.log("=".repeat(70));
  console.log(newHtml);
  console.log("=".repeat(70));

  if (!newHtml) { console.error("\nEMPTY output — not writing."); process.exit(1); }
  if (dry) { console.log("\n--dry: not written to DB."); }
  else {
    await prisma.product.update({ where: { id: productId }, data: { descriptionHtml: newHtml } });
    console.log("\nWritten to Product.descriptionHtml.");
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("UNHANDLED:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
