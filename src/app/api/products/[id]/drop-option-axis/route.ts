import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Drop an entire option axis from a product's variant matrix:
 *   - Delete every variant whose `optionN` !== keepValue.
 *   - On survivors: shift higher axes down past the dropped index, null the
 *     freed slot, re-derive `title`, and renumber `position` 0..N-1 by
 *     existing position order.
 *   - Null any `ProductImage.variantId` that points at a dropped variant so
 *     we don't leave dangling references.
 *   - Remove the dropped axis from `Product.optionNames`.
 *
 * All in one `prisma.$transaction`. The chained-PATCH alternative is rejected
 * because a half-commit (variants restructured but optionNames still names
 * the dropped axis) is a worse end state than a clean rollback.
 *
 * Body: { axisIndex: 0 | 1 | 2, keepValue: string | null }
 */
function parseOptionNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    // Fall through — may be a comma-separated list.
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

interface DropAxisBody {
  axisIndex?: unknown;
  keepValue?: unknown;
}

const OPT_KEYS = ["option1", "option2", "option3"] as const;
type OptKey = (typeof OPT_KEYS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: DropAxisBody;
  try {
    body = (await req.json()) as DropAxisBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const axisIndex = body.axisIndex;
  if (axisIndex !== 0 && axisIndex !== 1 && axisIndex !== 2) {
    return NextResponse.json({ error: "axisIndex must be 0, 1, or 2" }, { status: 400 });
  }
  if (typeof body.keepValue !== "string" && body.keepValue !== null) {
    return NextResponse.json({ error: "keepValue must be a string or null" }, { status: 400 });
  }
  const keepValue = body.keepValue as string | null;

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, userId: true, optionNames: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const optionNames = parseOptionNames(product.optionNames);

  // Case A: axisIndex points BEYOND optionNames.length. This happens when
  // optionNames was already trimmed (e.g. by the post-scrape audit's empty-
  // axis drop) but variant rows still hold residual data in option2/option3.
  // The frontend's `hasOption2 = variants.some(v => v.option2)` then shows
  // the column anyway — including based on HIDDEN variants. We treat this as
  // a "data cleanup" drop: null the column on every variant, leave optionNames
  // alone, no axis-restructure. The only error case is when the axis is also
  // truly empty on every variant — there's nothing to clean up.
  if (axisIndex >= optionNames.length) {
    const axisKey = OPT_KEYS[axisIndex];
    const allRows = await prisma.variant.findMany({
      where: { productId: id },
      select: { id: true, option1: true, option2: true, option3: true },
    });
    const dirty = allRows.filter((v) => {
      const val = v[axisKey];
      return typeof val === "string" && val.trim().length > 0;
    });
    if (dirty.length === 0) {
      return NextResponse.json(
        { error: `Product only has ${optionNames.length} axis(es) and column ${axisIndex} is already empty.` },
        { status: 400 },
      );
    }
    await prisma.variant.updateMany({
      where: { id: { in: dirty.map((v) => v.id) } },
      data: { [axisKey]: null },
    });
    return NextResponse.json({
      kept: allRows.length - dirty.length,
      dropped: 0,
      cleaned: dirty.length,
      optionNames,
    });
  }

  // Case B: axisIndex is within optionNames range but is the only remaining
  // axis. Allow dropping ONLY when it has no values on any visible variant —
  // that consolidates the product to a single-variant / no-options SKU. The
  // Shopify uploader's `isSingleVariantNoOptions` branch handles the result.
  if (optionNames.length <= 1) {
    const axisKey = OPT_KEYS[axisIndex];
    const visibleSample = await prisma.variant.findMany({
      where: { productId: id, isHidden: false },
      select: { option1: true, option2: true, option3: true },
    });
    const axisHasAnyValue = visibleSample.some((v) => {
      const val = v[axisKey];
      return typeof val === "string" && val.trim().length > 0;
    });
    if (axisHasAnyValue) {
      return NextResponse.json(
        { error: "Cannot drop the only remaining axis (it still has values on visible variants)." },
        { status: 400 },
      );
    }
  }

  // Operate on the visible rows only — hidden rows are conceptually
  // "deleted-but-recoverable", they shouldn't influence the new axis
  // structure. Hidden rows that survive the keep-value match would also
  // render the table empty (the table hides hidden rows by default), which
  // is the bug this branch fixes. Hidden rows get deleted alongside the
  // non-matching visible ones since they're orphaned from the new schema.
  const visible = await prisma.variant.findMany({
    where: { productId: id, isHidden: false },
    orderBy: { position: "asc" },
  });
  const hidden = await prisma.variant.findMany({
    where: { productId: id, isHidden: true },
    select: { id: true },
  });
  const key: OptKey = OPT_KEYS[axisIndex];
  const survivors = visible.filter((v) => v[key] === keepValue);
  const dropees = visible.filter((v) => v[key] !== keepValue);
  if (survivors.length === 0) {
    return NextResponse.json(
      { error: "No variants match keepValue — pick a value present on that axis." },
      { status: 400 },
    );
  }

  // Build the shift-down update for each survivor. Force isHidden: false
  // defensively — a survivor that was already visible stays visible; this
  // also covers any edge case where the user picked a value that survives.
  const updates = survivors.map((v, idx) => {
    const opts: (string | null)[] = [v.option1, v.option2, v.option3];
    opts.splice(axisIndex, 1); // drop the chosen axis slot
    opts.push(null); // pad back to length 3
    const [o1, o2, o3] = opts;
    const title =
      [o1, o2, o3].filter((x): x is string => typeof x === "string" && x.length > 0).join(" / ") ||
      v.title;
    return {
      id: v.id,
      option1: o1,
      option2: o2,
      option3: o3,
      title,
      position: idx,
      isHidden: false,
    };
  });

  // dropees = the visible non-matching rows + every previously-hidden row
  // (the hidden ones don't fit the new axis structure either).
  const dropeeIds = [...dropees.map((d) => d.id), ...hidden.map((h) => h.id)];
  const newOptionNames = [...optionNames];
  newOptionNames.splice(axisIndex, 1);

  await prisma.$transaction([
    ...updates.map((u) =>
      prisma.variant.update({
        where: { id: u.id },
        data: {
          option1: u.option1,
          option2: u.option2,
          option3: u.option3,
          title: u.title,
          position: u.position,
          isHidden: u.isHidden,
        },
      }),
    ),
    ...(dropeeIds.length > 0
      ? [
          prisma.productImage.updateMany({
            where: { productId: id, variantId: { in: dropeeIds } },
            data: { variantId: null },
          }),
          prisma.variant.deleteMany({ where: { id: { in: dropeeIds } } }),
        ]
      : []),
    prisma.product.update({
      where: { id },
      data: { optionNames: JSON.stringify(newOptionNames) },
    }),
  ]);

  return NextResponse.json({
    kept: survivors.length,
    dropped: dropees.length,
    optionNames: newOptionNames,
  });
}
