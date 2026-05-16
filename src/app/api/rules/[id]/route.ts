import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

const VALID_CATEGORIES = ["title", "description", "tags", "image", "seo"] as const;
type RuleCategory = (typeof VALID_CATEGORIES)[number];

interface RulePatchBody {
  name?: unknown;
  category?: unknown;
  config?: unknown;
  enabled?: unknown;
}

function isValidCategory(value: unknown): value is RuleCategory {
  return typeof value === "string" && (VALID_CATEGORIES as readonly string[]).includes(value);
}

function validateConfig(value: unknown):
  | { ok: true; config: { prompt: string; model?: string } }
  | { ok: false; error: string } {
  // Accept a JSON string that parses to an object (re-validate the parsed result).
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { ok: false, error: "config must be an object" };
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: "config must be an object" };
  }
  const obj = candidate as Record<string, unknown>;
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, error: "config.prompt is required" };
  }
  const config: { prompt: string; model?: string } = { prompt };
  if (typeof obj.model === "string" && obj.model.trim()) {
    config.model = obj.model.trim();
  }
  return { ok: true, config };
}

export async function PATCH(
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
  const existing = await prisma.transformationRule.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only owner can edit (global rules with userId=null are read-only here).
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: RulePatchBody;
  try {
    body = (await req.json()) as RulePatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    name?: string;
    category?: string;
    enabled?: boolean;
    config?: string;
  } = {};

  if (typeof body.name === "string") data.name = body.name;
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return NextResponse.json(
        { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }
    data.category = body.category;
  }
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.config !== undefined) {
    const configCheck = validateConfig(body.config);
    if (!configCheck.ok) {
      return NextResponse.json({ error: configCheck.error }, { status: 400 });
    }
    data.config = JSON.stringify(configCheck.config);
  }

  const rule = await prisma.transformationRule.update({ where: { id }, data });
  return NextResponse.json({ rule });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.transformationRule.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await prisma.transformationRule.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
