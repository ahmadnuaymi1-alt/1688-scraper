/**
 * Fix the latest 10 scraped products to match the updated description rule:
 *
 *   1. Convert any visible variant option1/2/3 value matching "<n> cm" or
 *      "<n> × <n> cm" into inches (multiplied by 0.394, rounded to 1 decimal).
 *      Only touches VISIBLE (isHidden=false) variants — hidden variants are
 *      curated out and don't reach the customer.
 *
 *   2. Re-run the user's description rule (reapplyRules with category
 *      "description") on each affected product so the new rule strips:
 *        - per-variant "What's Included" sub-section blocks
 *        - any remaining cm / mm / m² references in the description
 *        - supplier-internal identifier rows (Item Number, Model Number, etc.)
 *
 *   npx tsx scripts/_fix-recent-descriptions.ts [count]
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { reapplyRules } from "../src/services/rule.service";

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

/**
 * Convert a single option value containing one or more "<n> cm" tokens into
 * the inch equivalent string. Returns null when no cm token is present.
 *
 *   "60 cm"             →  "23.6\""
 *   "50 × 50 cm"        →  "19.7\" × 19.7\""
 *   "90 × 60 cm"        →  "35.4\" × 23.6\""
 *
 * Bare numbers (no cm token) and non-string inputs return null.
 */
function convertOptionCmToInches(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/\bcm\b/i.test(value)) return null;

  // Find "<n> [× <n> [× <n>]] cm" — collapse the whole match to inches.
  const out = value.replace(
    /(\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?){0,2})\s*cm\b/gi,
    (_m, numberGroup: string) => {
      const parts = numberGroup
        .split(/\s*[×xX*]\s*/)
        .map((n) => parseFloat(n))
        .filter((n) => Number.isFinite(n));
      if (parts.length === 0) return _m;
      const inches = parts.map((n) => `${(n / 2.54).toFixed(1)}"`).join(" × ");
      return inches;
    },
  );
  return out === value ? null : out;
}

interface FixPlan {
  productId: string;
  title: string;
  variantUpdates: Array<{
    variantId: string;
    position: number;
    field: "option1" | "option2" | "option3";
    from: string;
    to: string;
  }>;
  needsDescriptionRewrite: boolean;
  reason: string[];
}

async function buildFixPlan(prisma: PrismaClient, count: number): Promise<FixPlan[]> {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: count,
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
    },
  });

  const plans: FixPlan[] = [];
  for (const p of products) {
    const plan: FixPlan = {
      productId: p.id,
      title: p.title,
      variantUpdates: [],
      needsDescriptionRewrite: false,
      reason: [],
    };

    // Variant cm → inch conversions on VISIBLE variants only.
    for (const v of p.variants) {
      const slots: Array<"option1" | "option2" | "option3"> = ["option1", "option2", "option3"];
      for (const slot of slots) {
        const cur = v[slot];
        const converted = convertOptionCmToInches(cur);
        if (converted !== null && converted !== cur) {
          plan.variantUpdates.push({
            variantId: v.id,
            position: v.position,
            field: slot,
            from: cur ?? "",
            to: converted,
          });
        }
      }
    }

    // Detect signals that the description needs a rewrite.
    const desc = p.descriptionHtml ?? "";
    const ctx = p.productContext ?? "";

    if (/\bcm\b/i.test(desc) || /厘米/.test(desc)) {
      plan.needsDescriptionRewrite = true;
      plan.reason.push("cm-in-description");
    }
    // Per-variant What's Included sub-section heuristic: "<strong>... Variant</strong>"
    // appearing AFTER a "What's Included" anchor, before the next h2/h3.
    {
      const m = desc.match(/What['’]s\s+Included/i);
      if (m && m.index !== undefined) {
        const block = desc.slice(m.index);
        const cut = block.search(/<\/?h[23][\s>]/i);
        const region = cut > 0 ? block.slice(0, cut) : block;
        const subRe = /<strong>([^<]+)<\/strong>/gi;
        const subs: string[] = [];
        for (const sm of region.matchAll(subRe)) {
          const t = sm[1].trim();
          if (/what'?s\s+included/i.test(t)) continue;
          if (/\bvariant\b|\bversion\b|\bsize\b|\b\d+\s*(cm|mm|in(?:ch)?|"|m\b)/i.test(t)) {
            subs.push(t);
          }
        }
        if (subs.length > 0) {
          plan.needsDescriptionRewrite = true;
          plan.reason.push(`per-variant-blocks(${subs.length})`);
        }
      }
    }
    // Supplier-internal identifier rows in the spec table.
    if (
      /<(?:th|strong|td)[^>]*>\s*(?:Item\s+(?:Number|No)|Model\s+(?:Number|No)|Part\s+(?:Number|No)|SKU|Article\s+Number|Certificate\s+Number|Certification\s+Number|Cert\s+No)\b/i.test(
        desc,
      )
    ) {
      plan.needsDescriptionRewrite = true;
      plan.reason.push("supplier-internal-id-row");
    }
    // Variant changes themselves are reason enough to rewrite — the description
    // mentions variant sizes which will no longer match the renamed inch labels.
    if (plan.variantUpdates.length > 0 && !plan.needsDescriptionRewrite) {
      plan.needsDescriptionRewrite = true;
      plan.reason.push("variant-labels-changed");
    }
    // Also check productContext for cm / Item Number / etc. — surfaces when
    // descriptionHtml looks clean but the cached enrichment context still
    // contains supplier internals that a rewrite would surface.
    if (
      (/\bcm\b/i.test(ctx) || /厘米/.test(ctx) || /"name"\s*:\s*"Item\s+Number"/i.test(ctx)) &&
      !plan.needsDescriptionRewrite
    ) {
      // Don't rewrite purely on productContext signals — the user is concerned
      // with what shows on /review and the description is already clean. Note
      // it but skip the rewrite to avoid churn.
    }

    if (plan.variantUpdates.length > 0 || plan.needsDescriptionRewrite) {
      plans.push(plan);
    }
  }
  return plans;
}

async function main() {
  const count = Number(process.argv[2]) || 10;
  const dryRun = process.argv.includes("--dry-run");

  const prisma = new PrismaClient();
  try {
    const plans = await buildFixPlan(prisma, count);
    if (plans.length === 0) {
      console.log(`No fixes needed in the latest ${count} products.`);
      return;
    }

    console.log(`Fix plan for ${plans.length} product(s) (of ${count} most recent):\n`);
    for (const plan of plans) {
      console.log(`• ${plan.productId} — "${plan.title.slice(0, 60)}"`);
      if (plan.variantUpdates.length > 0) {
        console.log(`    Variant updates (${plan.variantUpdates.length}):`);
        for (const u of plan.variantUpdates) {
          console.log(`      pos ${u.position} ${u.field}: "${u.from}" → "${u.to}"`);
        }
      }
      if (plan.needsDescriptionRewrite) {
        console.log(`    Description rewrite: needed [${plan.reason.join(", ")}]`);
      }
    }

    if (dryRun) {
      console.log(`\n(dry-run — no changes applied)`);
      return;
    }

    console.log(`\nApplying variant updates...`);
    const allVariantUpdates = plans.flatMap((p) => p.variantUpdates);
    if (allVariantUpdates.length > 0) {
      await prisma.$transaction(
        allVariantUpdates.map((u) =>
          prisma.variant.update({
            where: { id: u.variantId },
            data: { [u.field]: u.to },
          }),
        ),
      );
      console.log(`  ✓ ${allVariantUpdates.length} variant field(s) updated.`);
    } else {
      console.log(`  (no variant updates)`);
    }

    console.log(`\nRunning description rewrites...`);
    for (const plan of plans) {
      if (!plan.needsDescriptionRewrite) continue;
      const t0 = Date.now();
      try {
        await reapplyRules(plan.productId, "description");
        console.log(`  ✓ ${plan.productId} rewritten in ${Date.now() - t0}ms`);
      } catch (err) {
        console.error(
          `  ✗ ${plan.productId} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    console.log(`\nDone.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
