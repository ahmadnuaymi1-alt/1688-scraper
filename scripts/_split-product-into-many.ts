/**
 * Split ONE scraped product into MULTIPLE products.
 *
 * Two ways to define the partition:
 *   --by-axis N   auto-group the product's visible variants by their Nth option
 *                 axis value (1|2|3). Each distinct value becomes a child; the
 *                 split axis is dropped and the remaining axes shift into
 *                 option1.. on the child.
 *   --spec FILE   explicit groups: { keepAxes?: number[], groups: [
 *                   { titleSuffix, optionNames, variantIds:[...] } ] }
 *                 keepAxes = which PARENT axis indexes (1|2|3) each child keeps,
 *                 in order (child.option1 = parent.option[keepAxes[0]], ...).
 *
 * Children clone the parent's product fields, the group's variants, and those
 * variants' images (+ the shared product-level gallery), with featuredImageId
 * repointed to the child's image clones. Lifestyle images are NOT cloned (they
 * are product-level and regenerated per child).
 *
 * DRY-RUN by default — prints the plan. Pass --apply to write. All writes are
 * SEQUENTIAL (the shared Supabase pool is connection_limit=1).
 *
 *   npx tsx scripts/_split-product-into-many.ts <parentIdOrUrl> --by-axis 1 [--parent delete|keep-hidden|keep] [--apply]
 *   npx tsx scripts/_split-product-into-many.ts <parentIdOrUrl> --spec spec.json --parent delete --apply
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const prisma = new PrismaClient();

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function detectId(s: string): string {
  const m = s.match(/\/review\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : s;
}
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";

interface PlanGroup {
  titleSuffix: string;
  optionNames: string[];
  keepAxes: number[]; // 1-based parent axis indexes, in child order
  variants: Array<Awaited<ReturnType<typeof loadParent>>["variants"][number]>;
}

async function loadParent(parentId: string) {
  const parent = await prisma.product.findUnique({
    where: { id: parentId },
    include: { variants: { orderBy: { position: "asc" } }, images: { orderBy: { position: "asc" } } },
  });
  if (!parent) throw new Error(`parent product ${parentId} not found`);
  return parent;
}

function optAt(v: { option1: string | null; option2: string | null; option3: string | null }, axis1based: number) {
  return [v.option1, v.option2, v.option3][axis1based - 1] ?? null;
}

async function main() {
  const parentArg = process.argv[2];
  if (!parentArg) {
    console.error("Usage: tsx scripts/_split-product-into-many.ts <parentIdOrUrl> (--by-axis N | --spec file) [--parent delete|keep-hidden|keep] [--apply]");
    process.exit(1);
  }
  const parentId = detectId(parentArg);
  const byAxis = flag("--by-axis");
  const specPath = flag("--spec");
  const parentMode = (flag("--parent") ?? "keep-hidden") as "delete" | "keep-hidden" | "keep";
  const apply = process.argv.includes("--apply");

  const parent = await loadParent(parentId);
  const parentOptionNames: string[] = (() => {
    try {
      const a = JSON.parse(parent.optionNames ?? "[]");
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  })();
  const visible = parent.variants.filter((v) => !v.isHidden);

  console.log(`Parent: ${parent.title.slice(0, 70)} (${parent.id})`);
  console.log(`  optionNames: ${JSON.stringify(parentOptionNames)}  | visible variants: ${visible.length}  | total: ${parent.variants.length}`);

  // ── Build the partition ──────────────────────────────────────────────────
  let groups: PlanGroup[];
  if (byAxis) {
    const axis = parseInt(byAxis, 10);
    if (![1, 2, 3].includes(axis)) throw new Error("--by-axis must be 1, 2, or 3");
    const keepAxes = [1, 2, 3].filter((a) => a <= parentOptionNames.length && a !== axis);
    const childOptionNames = parentOptionNames.filter((_, i) => i !== axis - 1);
    const byValue = new Map<string, PlanGroup["variants"]>();
    for (const v of visible) {
      const val = optAt(v, axis) ?? "(none)";
      if (!byValue.has(val)) byValue.set(val, []);
      byValue.get(val)!.push(v);
    }
    groups = [...byValue.entries()].map(([val, vars]) => ({
      titleSuffix: val,
      optionNames: childOptionNames,
      keepAxes,
      variants: vars,
    }));
  } else if (specPath) {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf-8")) as {
      keepAxes?: number[];
      groups: Array<{ titleSuffix: string; optionNames: string[]; variantIds: string[]; keepAxes?: number[] }>;
    };
    const defaultKeep = spec.keepAxes ?? [1, 2, 3].filter((a) => a <= parentOptionNames.length);
    const byId = new Map(parent.variants.map((v) => [v.id, v]));
    groups = spec.groups.map((g) => ({
      titleSuffix: g.titleSuffix,
      optionNames: g.optionNames,
      keepAxes: g.keepAxes ?? defaultKeep,
      variants: g.variantIds.map((id) => byId.get(id)).filter((v): v is NonNullable<typeof v> => !!v),
    }));
  } else {
    throw new Error("provide --by-axis N or --spec file");
  }

  // ── Validate ─────────────────────────────────────────────────────────────
  const assigned = new Set<string>();
  let bad = false;
  for (const g of groups) {
    if (g.variants.length === 0) { console.error(`  ! group "${g.titleSuffix}" has 0 variants`); bad = true; }
    if (g.optionNames.length !== g.keepAxes.length) { console.error(`  ! group "${g.titleSuffix}" optionNames(${g.optionNames.length}) != keepAxes(${g.keepAxes.length})`); bad = true; }
    if (g.optionNames.length > 3) { console.error(`  ! group "${g.titleSuffix}" has >3 axes`); bad = true; }
    for (const v of g.variants) {
      if (assigned.has(v.id)) { console.error(`  ! variant ${v.id} in multiple groups`); bad = true; }
      assigned.add(v.id);
    }
  }
  const leftover = visible.filter((v) => !assigned.has(v.id));
  if (leftover.length) console.warn(`  ⚠ ${leftover.length} visible variant(s) not assigned to any group (they will be left on / deleted with the parent).`);
  if (bad) { console.error("Validation failed — aborting."); process.exit(1); }

  // ── Print plan ───────────────────────────────────────────────────────────
  console.log(`\nPlan — ${groups.length} child product(s), parent mode = ${parentMode}:`);
  for (const g of groups) {
    console.log(`  • "${parent.title.slice(0, 30)} — ${g.titleSuffix}"  axes=${JSON.stringify(g.optionNames)}  variants=${g.variants.length}`);
    for (const v of g.variants.slice(0, 4)) {
      const opts = g.keepAxes.map((a) => optAt(v, a)).filter(Boolean).join(" / ");
      console.log(`      ${opts || v.title}  $${v.price}`);
    }
    if (g.variants.length > 4) console.log(`      … +${g.variants.length - 4} more`);
  }

  if (!apply) {
    console.log(`\n[dry-run] No changes written. Re-run with --apply to create the children.`);
    await prisma.$disconnect();
    return;
  }

  // ── Apply (sequential) ───────────────────────────────────────────────────
  console.log(`\n--apply: creating children...`);
  const childIds: string[] = [];
  for (const g of groups) {
    const child = await prisma.product.create({
      data: {
        userId: parent.userId,
        scrapeJobId: null,
        title: `${parent.title} — ${g.titleSuffix}`,
        handle: `${parent.handle}-${slug(g.titleSuffix)}`,
        vendor: parent.vendor,
        productType: parent.productType,
        tags: parent.tags,
        descriptionHtml: parent.descriptionHtml,
        metaDescription: parent.metaDescription,
        optionNames: JSON.stringify(g.optionNames),
        pricingNotes: parent.pricingNotes,
        productContext: parent.productContext,
        minOrderQuantity: parent.minOrderQuantity,
        lifestyleUnitMode: parent.lifestyleUnitMode,
        rawPayload: parent.rawPayload,
      },
    });
    childIds.push(child.id);

    // Clone variants
    const varMap = new Map<string, string>();
    let pos = 0;
    for (const v of g.variants) {
      const opts = g.keepAxes.map((a) => optAt(v, a));
      const newTitle = opts.filter(Boolean).join(" / ") || v.title;
      const sku = parentMode === "delete" ? v.sku : v.sku ? `${v.sku}-${child.id.slice(-4)}` : null;
      const nv = await prisma.variant.create({
        data: {
          productId: child.id,
          title: newTitle,
          option1: opts[0] ?? null,
          option2: opts[1] ?? null,
          option3: opts[2] ?? null,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          supplierCost: v.supplierCost,
          sku,
          barcode: v.barcode,
          weight: v.weight,
          weightUnit: v.weightUnit,
          packagingDimensions: v.packagingDimensions,
          position: pos++,
          sourceVariantId: v.sourceVariantId,
          isHidden: false,
          supplierLabel1: v.supplierLabel1,
          supplierLabel2: v.supplierLabel2,
          supplierLabel3: v.supplierLabel3,
        },
      });
      varMap.set(v.id, nv.id);
    }

    // Clone images: per-variant images for this group + shared product-level
    // gallery; skip lifestyle (product-level, regenerated per child).
    const groupVarIds = new Set(g.variants.map((v) => v.id));
    const imgsToClone = parent.images.filter(
      (img) =>
        img.imageType !== "lifestyle" &&
        ((img.variantId && groupVarIds.has(img.variantId)) || !img.variantId),
    );
    const imgMap = new Map<string, string>();
    for (const img of imgsToClone) {
      const ni = await prisma.productImage.create({
        data: {
          productId: child.id,
          variantId: img.variantId ? varMap.get(img.variantId) ?? null : null,
          sourceUrl: img.sourceUrl,
          storagePath: img.storagePath,
          fileName: img.fileName,
          altText: img.altText,
          position: img.position,
          width: img.width,
          height: img.height,
          downloadStatus: img.downloadStatus,
          imageType: img.imageType,
          keep: img.keep,
          ocrDimsText: img.ocrDimsText,
          ocrPromptVersion: img.ocrPromptVersion,
        },
      });
      imgMap.set(img.id, ni.id);
    }

    // Repoint child variants' featuredImageId to the cloned image.
    for (const v of g.variants) {
      if (!v.featuredImageId) continue;
      const newImgId = imgMap.get(v.featuredImageId);
      if (newImgId) {
        await prisma.variant.update({ where: { id: varMap.get(v.id)! }, data: { featuredImageId: newImgId } });
      }
    }
    console.log(`  ✓ child ${child.id}  "${g.titleSuffix}"  variants=${g.variants.length}  images=${imgsToClone.length}`);
  }

  // ── Parent handling ──────────────────────────────────────────────────────
  if (parentMode === "delete") {
    await prisma.product.delete({ where: { id: parentId } });
    console.log(`  parent deleted.`);
  } else if (parentMode === "keep-hidden") {
    await prisma.variant.updateMany({ where: { productId: parentId }, data: { isHidden: true } });
    console.log(`  parent variants hidden.`);
  } else {
    console.log(`  parent kept as-is.`);
  }

  // ── Verify ───────────────────────────────────────────────────────────────
  console.log(`\nVerification:`);
  for (const cid of childIds) {
    const c = await prisma.product.findUnique({
      where: { id: cid },
      include: { variants: true, images: true },
    });
    if (!c) { console.log(`  ${cid}: MISSING`); continue; }
    const live = c.variants.filter((v) => !v.isHidden);
    const withFeatured = live.filter((v) => v.featuredImageId).length;
    console.log(
      `  ${cid}  "${c.title.slice(0, 45)}"  variants=${c.variants.length} live=${live.length} withFeaturedImg=${withFeatured} images=${c.images.length}  optionNames=${c.optionNames}`,
    );
    console.log(`     review: http://localhost:3000/review/${cid}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
