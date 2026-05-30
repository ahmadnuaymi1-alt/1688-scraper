import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { reapplyRules, type RuleCategory } from "@/services/rule.service";

const VALID_CATEGORIES: RuleCategory[] = ["title", "description", "tags", "image", "seo"];

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
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.userId && product.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Body accepts EITHER:
  //   { category: "description" }      (legacy single)
  //   { categories: ["description","title"] }  (multi)
  //   {} or no body                    (apply all categories)
  let parsed: { category?: unknown; categories?: unknown } = {};
  try {
    const text = await req.text();
    if (text) parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let categories: RuleCategory[] | undefined;
  if (Array.isArray(parsed.categories)) {
    const out: RuleCategory[] = [];
    for (const c of parsed.categories) {
      if (typeof c !== "string" || !VALID_CATEGORIES.includes(c as RuleCategory)) {
        return NextResponse.json(
          { error: `Invalid category "${c}". Expected one of: ${VALID_CATEGORIES.join(", ")}` },
          { status: 400 },
        );
      }
      if (!out.includes(c as RuleCategory)) out.push(c as RuleCategory);
    }
    categories = out;
  } else if (typeof parsed.category === "string") {
    if (!VALID_CATEGORIES.includes(parsed.category as RuleCategory)) {
      return NextResponse.json(
        { error: `Invalid category. Expected one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }
    categories = [parsed.category as RuleCategory];
  }

  // BLOCKING: was fire-and-forget (returned 202 + `void reapplyRules(...)`),
  // but Next.js dev mode kills detached promises on HMR, so the rule never
  // ran to completion AND the client had no way to know when to refresh the
  // UI. Now we await — the client gets a real success/failure response and
  // can refresh once the DB is actually up-to-date.
  try {
    await reapplyRules(id, categories);
  } catch (err) {
    console.error(`[api/products/${id}/reapply-rules] error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Re-apply failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    status: "done",
    categories: categories ?? "all",
  });
}

// LLM-driven rules can be slow; bump the prod (Vercel) cap.
export const maxDuration = 300;
