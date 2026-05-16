import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULTS = [
  {
    name: "Standard product title",
    category: "title",
    isDefault: true,
    config: {
      model: "gpt-4.1-mini",
      prompt: `Rewrite this product title for a luxury Shopify store. Format: [Style Modifier] [Material/Color/Form] [Tech Feature] [optional Light Count] [Specific Product Type]. 45-70 chars. Sentence case. NO brand names. NO em dashes. Return ONLY the new title — no quotes, no explanation.`,
    },
  },
  {
    name: "Standard description",
    category: "description",
    isDefault: true,
    config: {
      model: "gpt-4.1-mini",
      prompt: `Rewrite this product description for SEO and conversion. Use H2 section headers. Bold the benefit + plain text after each bullet. NO em dashes. NO <img> tags. Reference the supplier spec table (productContext.extractedSpecs) for accurate dimensions and materials. Return ONLY HTML — no markdown fences.`,
    },
  },
  {
    name: "Standard tags",
    category: "tags",
    isDefault: true,
    config: {
      model: "gpt-4.1-mini",
      prompt: `Generate 8-15 Shopify product tags for this listing. Include: product type, primary material, style (modern/vintage/etc), use case, room. Comma-separated, lowercase. No duplicates. Return ONLY the comma-separated list.`,
    },
  },
  {
    name: "Image filename + alt text",
    category: "image",
    isDefault: true,
    config: {
      model: "gpt-4.1-mini",
      prompt: `For each image, return a SEO filename in kebab-case (no extension) and natural-sentence alt text (5-12 words, mentions the product). JSON array, one object per image.`,
    },
  },
  {
    name: "SEO meta description",
    category: "seo",
    isDefault: true,
    config: {
      model: "gpt-4.1-mini",
      prompt: `Write a meta description for this product. 120-160 characters. Lead with the primary benefit + use case. End with a soft CTA. NO emojis, NO quotes. Return ONLY the meta description string.`,
    },
  },
];

async function main() {
  for (const d of DEFAULTS) {
    const existing = await prisma.ruleTemplate.findFirst({
      where: { name: d.name, category: d.category, userId: null },
    });
    if (existing) {
      await prisma.ruleTemplate.update({
        where: { id: existing.id },
        data: { config: JSON.stringify(d.config), isDefault: d.isDefault },
      });
    } else {
      await prisma.ruleTemplate.create({
        data: {
          name: d.name,
          category: d.category,
          isDefault: d.isDefault,
          config: JSON.stringify(d.config),
          userId: null,
        },
      });
    }
    console.log(`Seeded default template: ${d.category}/${d.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
