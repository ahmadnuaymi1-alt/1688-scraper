/**
 * One-off curation script implementing the approved plan
 * (C:\Users\pc\.claude\plans\task-notification-task-id-bbmu45m9o-tas-rosy-key.md).
 *
 * Applies the user's "minimum variants" philosophy to each of the 10
 * products from the 2026-05-29 7:43 PM batch. Each product is processed
 * inside its own `prisma.$transaction` so a partial failure doesn't
 * leave anything half-curated.
 *
 * After this runs, the user reviews the visible variants on each
 * /review/<id> page. Once they sign off, the same philosophy is baked
 * into the LLM curation prompt so future scrapes hit this shape
 * automatically.
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

const prisma = new PrismaClient();

// ── Helpers ─────────────────────────────────────────────────────────────────
async function findProductByOffer(offer: string) {
  const job = await prisma.scrapeJob.findFirst({
    where: { sourceUrl: { contains: offer } },
    orderBy: { createdAt: "desc" },
    select: {
      product: {
        select: {
          id: true,
          title: true,
          optionNames: true,
          variants: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              title: true,
              option1: true,
              option2: true,
              option3: true,
              price: true,
              compareAtPrice: true,
              isHidden: true,
            },
          },
        },
      },
    },
  });
  return job?.product ?? null;
}

interface CurationOp {
  hide?: string[]; // variant IDs to hide
  unhide?: string[]; // variant IDs to unhide (rare)
  updateVariants?: Array<{
    id: string;
    data: {
      option1?: string | null;
      option2?: string | null;
      option3?: string | null;
      title?: string;
    };
  }>;
  newOptionNames?: string[]; // sets Product.optionNames if defined
}

async function applyCuration(productId: string, op: CurationOp): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (op.hide && op.hide.length > 0) {
      await tx.variant.updateMany({
        where: { id: { in: op.hide } },
        data: { isHidden: true },
      });
    }
    if (op.unhide && op.unhide.length > 0) {
      await tx.variant.updateMany({
        where: { id: { in: op.unhide } },
        data: { isHidden: false },
      });
    }
    if (op.updateVariants && op.updateVariants.length > 0) {
      for (const u of op.updateVariants) {
        await tx.variant.update({ where: { id: u.id }, data: u.data });
      }
    }
    if (op.newOptionNames !== undefined) {
      await tx.product.update({
        where: { id: productId },
        data: { optionNames: JSON.stringify(op.newOptionNames) },
      });
    }
  });
}

// ── Per-product curations ───────────────────────────────────────────────────

// 1. 757078812031 — drop Multicolor blade color → 9 variants
async function curate1(): Promise<string> {
  const p = await findProductByOffer("757078812031");
  if (!p) return "1: NOT FOUND";
  const targets = p.variants.filter(
    (v) => !v.isHidden && (v.option2 ?? "").toLowerCase() === "multicolor",
  );
  await applyCuration(p.id, { hide: targets.map((t) => t.id) });
  const remainingVisible = await prisma.variant.count({
    where: { productId: p.id, isHidden: false },
  });
  return `1 [757078812031]: hid ${targets.length} Multicolor variant(s) → ${remainingVisible} visible`;
}

// 4. 726916268618 — drop Light Color axis, keep Warm White, → 6 variants on Size
async function curate4(): Promise<string> {
  const p = await findProductByOffer("726916268618");
  if (!p) return "4: NOT FOUND";
  // optionNames is currently ["Size", "Light Color"] — Light Color at index 1.
  // Visible variants: option1 = Size value, option2 = Light Color value.
  // Keep only variants where option2 matches "warm" / "warm white" / "2700K" etc.
  const isWarm = (v: string | null) => !!v && /warm/i.test(v);
  const visible = p.variants.filter((v) => !v.isHidden);
  const keep = visible.filter((v) => isWarm(v.option2));
  const drop = visible.filter((v) => !isWarm(v.option2));
  if (keep.length === 0) {
    return `4 [726916268618]: NO Warm-White variant found — aborting`;
  }
  // For survivors: null out option2 (the dropped axis), refresh title to just the Size.
  const updates = keep.map((k) => ({
    id: k.id,
    data: {
      option2: null,
      title: k.option1 ?? "Default Title",
    },
  }));
  await applyCuration(p.id, {
    hide: drop.map((d) => d.id),
    updateVariants: updates,
    newOptionNames: ["Size"],
  });
  return `4 [726916268618]: kept ${keep.length} Warm variants, hid ${drop.length}, dropped Light Color axis`;
}

// 7. 946467767757 — split conflated "Size & Power" → Color × Size, 8 variants
async function curate7(): Promise<string> {
  const p = await findProductByOffer("946467767757");
  if (!p) return "7: NOT FOUND";
  // Current option1 values look like e.g. "8" Black 6W", "32" White & Gold 24W"
  // Need to parse each one into { color, size } then rewrite option1 = color, option2 = size.
  const visible = p.variants.filter((v) => !v.isHidden);
  function parse(o1: string | null): { color: string; size: string } | null {
    if (!o1) return null;
    // Look for size pattern like 8", 12", 16", 24", 32"
    const sizeMatch = o1.match(/(\d{1,3})\s*(?:"|inch|in\b)/i);
    if (!sizeMatch) return null;
    const size = `${sizeMatch[1]}"`;
    // Color: "Black" if "black" appears, else "White & Gold"
    const color = /black/i.test(o1) ? "Black" : "White & Gold";
    return { color, size };
  }
  const updates: Array<{ id: string; data: { option1: string; option2: string; option3: null; title: string } }> = [];
  const failures: string[] = [];
  for (const v of visible) {
    const parsed = parse(v.option1);
    if (!parsed) {
      failures.push(`  pos=${v.position} could not parse "${v.option1}"`);
      continue;
    }
    updates.push({
      id: v.id,
      data: {
        option1: parsed.color,
        option2: parsed.size,
        option3: null,
        title: `${parsed.color} / ${parsed.size}`,
      },
    });
  }
  await applyCuration(p.id, {
    updateVariants: updates,
    newOptionNames: ["Color", "Size"],
  });
  const tail = failures.length > 0 ? `\n${failures.join("\n")}` : "";
  return `7 [946467767757]: split conflated axis → ${updates.length} variants on Color × Size${tail}`;
}

// 8. 660494385149 — drop motion-sensor axis, keep with-sensor, → 2 variants on Color
async function curate8(): Promise<string> {
  const p = await findProductByOffer("660494385149");
  if (!p) return "8: NOT FOUND";
  // Visible variants have option1 values like "Black Without Motion Sensor",
  // "Black With Motion Sensor", "Antique Bronze Without Motion Sensor",
  // "Antique Bronze With Motion Sensor". Pick the "With Motion Sensor" ones.
  const visible = p.variants.filter((v) => !v.isHidden);
  const withSensor = visible.filter((v) =>
    /\bwith\s+motion\s+sensor\b/i.test(v.option1 ?? ""),
  );
  const withoutSensor = visible.filter((v) =>
    /\bwithout\s+motion\s+sensor\b/i.test(v.option1 ?? ""),
  );
  // Rename the kept ones to just the color part.
  const updates = withSensor.map((v) => {
    const raw = v.option1 ?? "";
    const color = raw.replace(/\s*With\s+Motion\s+Sensor\b/i, "").trim();
    return {
      id: v.id,
      data: { option1: color, title: color },
    };
  });
  await applyCuration(p.id, {
    hide: withoutSensor.map((v) => v.id),
    updateVariants: updates,
    newOptionNames: ["Color"],
  });
  return `8 [660494385149]: kept ${withSensor.length} With-Sensor variants (renamed to color), hid ${withoutSensor.length} Without-Sensor, axis → "Color"`;
}

// 9. 694503585724 — drop Power axis entirely, keep 18W as the single default
async function curate9(): Promise<string> {
  const p = await findProductByOffer("694503585724");
  if (!p) return "9: NOT FOUND";
  // Find the 18W variant. option1 should be "12W Black" / "18W Black" / etc.
  const visible = p.variants.filter((v) => !v.isHidden);
  const keep = visible.find((v) => /\b18\s*w\b/i.test(v.option1 ?? ""));
  if (!keep) {
    return `9 [694503585724]: NO 18W variant found — aborting`;
  }
  const drop = visible.filter((v) => v.id !== keep.id);
  await applyCuration(p.id, {
    hide: drop.map((d) => d.id),
    updateVariants: [
      {
        id: keep.id,
        data: { option1: null, option2: null, option3: null, title: "Default Title" },
      },
    ],
    newOptionNames: [],
  });
  return `9 [694503585724]: kept 18W as single default (Default Title), hid ${drop.length} other power variants, axis dropped`;
}

// ── Driver ──────────────────────────────────────────────────────────────────
(async () => {
  console.log("=== Applying minimum-variants curation per approved plan ===\n");
  const results: string[] = [];
  results.push(await curate1());
  // 2, 3 — no change (already correct)
  results.push("2 [679190421287]: no change — Size × 3 already correct");
  results.push("3 [980517211224]: no change — Finish × 2 already correct");
  results.push(await curate4());
  results.push("5 [919709046930]: no change — Color × 2 already correct");
  results.push("6 [789901292420]: no change — Size × 4 already correct");
  results.push(await curate7());
  results.push(await curate8());
  results.push(await curate9());
  results.push("10 [1040879560713]: no change — Mount Type × Color = 6 already correct");

  console.log(results.join("\n"));
  console.log("\n=== Done ===\n");

  // Re-inventory to confirm.
  const offers = [
    "757078812031", "679190421287", "980517211224", "726916268618",
    "919709046930", "789901292420", "946467767757", "660494385149",
    "694503585724", "1040879560713",
  ];
  console.log("=== Post-curation state ===\n");
  for (const offer of offers) {
    const p = await findProductByOffer(offer);
    if (!p) continue;
    const visible = await prisma.variant.findMany({
      where: { productId: p.id, isHidden: false },
      orderBy: { position: "asc" },
      select: { position: true, title: true, option1: true, option2: true, option3: true, price: true },
    });
    console.log(`${offer}  optionNames=${p.optionNames}  visible=${visible.length}`);
    for (const v of visible) {
      console.log(
        `  pos=${String(v.position).padStart(2)}  "${v.title}"  [${v.option1 ?? "—"}|${v.option2 ?? "—"}|${v.option3 ?? "—"}]  $${v.price}`,
      );
    }
    console.log("");
  }

  await prisma.$disconnect();
})();
