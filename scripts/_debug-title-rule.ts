/**
 * Debug: print the EXACT user message the title rule sends to the LLM for a
 * specific product ID, plus the live variants and what the LLM actually
 * returns. Helps diagnose why some products echo their input title back.
 *
 *   npx tsx scripts/_debug-title-rule.ts <productId>
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

async function main() {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write(`Usage: npx tsx scripts/_debug-title-rule.ts <productId>\n`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) { process.stderr.write(`Product ${id} not found\n`); process.exit(1); }
  const variants = await prisma.variant.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
    select: { option1: true, option2: true, option3: true, price: true, isHidden: true },
  });
  process.stdout.write(`Product: ${id}\n`);
  process.stdout.write(`  Title: ${product.title}\n`);
  process.stdout.write(`  Vendor: ${product.vendor}\n`);
  process.stdout.write(`  optionNames: ${product.optionNames}\n`);
  process.stdout.write(`  variants total: ${variants.length} | visible: ${variants.filter((v) => !v.isHidden).length}\n`);
  for (const v of variants.slice(0, 8)) {
    process.stdout.write(`    hidden=${v.isHidden} ${[v.option1, v.option2, v.option3].filter(Boolean).join(" | ")} @ ${v.price}\n`);
  }
  if (variants.length > 8) process.stdout.write(`    ... (+${variants.length - 8})\n`);

  // Build the user message exactly the way applyTitleRules does
  const rule = await prisma.transformationRule.findFirst({ where: { category: "title", enabled: true } });
  if (!rule) { process.stderr.write(`No enabled title rule found\n`); process.exit(1); }
  const cfg = JSON.parse(rule.config) as { prompt: string; model?: string };

  // Mini reimplementation of buildProductContextBlock + loadLiveVariantBlock
  const ctxParts: string[] = [];
  ctxParts.push(`Title: ${product.title}`);
  if (product.vendor) ctxParts.push(`Vendor: ${product.vendor}`);
  if (product.productType) ctxParts.push(`Product Type: ${product.productType}`);
  if (product.tags) ctxParts.push(`Tags: ${product.tags}`);
  if (product.optionNames) {
    try {
      const arr = JSON.parse(product.optionNames);
      if (Array.isArray(arr) && arr.length > 0) ctxParts.push(`Variant axes: ${arr.join(" / ")}`);
    } catch { /* */ }
  }
  if (product.productContext) {
    try {
      const ctx = JSON.parse(product.productContext);
      if (Array.isArray(ctx.extractedSpecs) && ctx.extractedSpecs.length > 0) {
        ctxParts.push(`Specifications:\n${ctx.extractedSpecs.slice(0, 25).map((s: { name: string; value: string }) => `  - ${s.name}: ${s.value}`).join("\n")}`);
      }
      if (Array.isArray(ctx.featureCallouts) && ctx.featureCallouts.length > 0) {
        ctxParts.push(`Feature callouts:\n${ctx.featureCallouts.map((f: string) => `  - ${f}`).join("\n")}`);
      }
    } catch { /* */ }
  }
  if (product.descriptionHtml) {
    const t = product.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t) ctxParts.push(`Description summary (first 800 chars):\n${t.slice(0, 800)}`);
  }
  const ctxBlock = ctxParts.join("\n\n");

  const live = variants.filter((v) => !v.isHidden);
  let variantBlock: string;
  if (live.length === 0) {
    variantBlock = "Live variants (NONE — all hidden or no variants exist).";
  } else {
    variantBlock = `Live variants (${live.length}):\n` + live.slice(0, 20).map((v) => `  - ${[v.option1, v.option2, v.option3].filter(Boolean).join(" / ")} @ $${v.price}`).join("\n");
  }

  const userMessage = `${cfg.prompt}\n\nProduct context:\n${ctxBlock}\n\n${variantBlock}\n\nCRITICAL — STAY INSIDE THE LIVE VARIANT SET:\nThe customer can ONLY buy what's listed above. Do NOT mention a feature, control type, light type, material variant, color, size, capacity, charging method, or option value that doesn't appear in that list. If a value comes from the supplier description (e.g. "LED", "USB-C", "Cordless", "Touch", "Dimmable") but isn't represented in any live variant, omit it from your output — the customer can't actually buy it.\n\nReturn ONLY the new product title. No explanation, no surrounding quotes, no markdown.`;

  process.stdout.write(`\n========== USER MESSAGE (${userMessage.length} chars) ==========\n`);
  process.stdout.write(userMessage);
  process.stdout.write(`\n========== END USER MESSAGE ==========\n\n`);

  // Now make the actual OpenAI call to see what comes back
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { process.stderr.write(`OPENAI_API_KEY not set\n`); process.exit(1); }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model ?? "gpt-4.1-mini",
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 256,
      temperature: 0.4,
    }),
  });
  const data = await res.json();
  process.stdout.write(`status: ${res.status}\n`);
  process.stdout.write(`response: ${JSON.stringify(data).slice(0, 1500)}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
