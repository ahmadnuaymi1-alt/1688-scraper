/**
 * Diagnostic: run the image rule on ONE product with full error visibility.
 * The rule.service.ts silently catches LLM errors and continues; this script
 * reaches into the same path but surfaces the actual failure.
 */
import fs from "node:fs";
import path from "node:path";
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
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { openaiJSON } from "../src/lib/ai/openai-client";

const ImageRuleResponseSchema = z.array(
  z.object({ fileName: z.string().min(1), altText: z.string().min(1) }),
);

async function main() {
  const productId = process.argv[2] || "cmpjsymhx015fw2gg6zf5kp9n";
  const prisma = new PrismaClient();

  const rule = await prisma.transformationRule.findFirst({
    where: { category: "image", enabled: true },
    select: { id: true, name: true, config: true },
  });
  if (!rule) { console.error("No enabled image rule"); return; }
  const cfg = JSON.parse(rule.config) as { prompt: string; model?: string };
  console.log(`Rule: ${rule.name} (model=${cfg.model || "gpt-4.1-mini"})`);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, vendor: true, productType: true, tags: true, descriptionHtml: true, optionNames: true, productContext: true },
  });
  if (!product) { console.error("Product not found"); return; }
  const images = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, fileName: true, altText: true },
  });
  console.log(`Product: ${product.title}\nImages: ${images.length}`);

  const imageList = images
    .map((img) => `  ${img.position}. id=${img.id} | current fileName=${img.fileName ?? "(none)"} | current altText=${img.altText ?? "(none)"}`)
    .join("\n");

  const userMessage = `${cfg.prompt}

Product context:
Title: ${product.title}
Type: ${product.productType ?? ""}
Tags: ${product.tags ?? ""}

You will rename ${images.length} product image(s) listed below. Each entry is a DISTINCT image identified by its \`id\` — treat every row as a unique image even if many currently share the same filename (or all show "(none)"). The \`position\` field is the display order in the product gallery; the FIRST image (position 0) is the primary/hero, subsequent positions are detail / lifestyle / variant shots.

Return a JSON array with EXACTLY ${images.length} entries, in the same order as the list below. Do NOT ask for clarification, do NOT return an error object — generate output for every ID:

${imageList}

Each entry MUST match this shape:
[
  { "fileName": "<filename per the rule above>", "altText": "<alt text per the rule above>" },
  ...
]

Follow the rule above for filename format, length, and the level of descriptive detail expected. Make each fileName UNIQUE across this batch — incorporate the position number, a scene/angle descriptor, or a variant cue so no two filenames collide. Return ONLY the JSON array — no markdown fences, no commentary.`;

  console.log(`\n>>> Sending ${userMessage.length} chars to OpenAI (model=${cfg.model || "gpt-4.1-mini"})\n`);

  try {
    const response = await openaiJSON({
      model: cfg.model || "gpt-4.1-mini",
      user: userMessage,
      maxTokens: 4096,
      temperature: 0.4,
      schema: ImageRuleResponseSchema,
    });
    console.log(`<<< Got ${response.length} entries.`);
    console.log("First 3:", JSON.stringify(response.slice(0, 3), null, 2));
  } catch (e) {
    console.error("OpenAI call FAILED:");
    console.error(e instanceof Error ? e.message : String(e));
    if (e instanceof Error && e.stack) console.error(e.stack.slice(0, 1000));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("UNHANDLED:", e); process.exit(1); });
