import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

const VALID_CATEGORIES = ["title", "description", "tags", "image", "seo"] as const;
type RuleCategory = (typeof VALID_CATEGORIES)[number];

interface RuleCreateBody {
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

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const enabledParam = searchParams.get("enabled");

  const where: {
    category?: string;
    enabled?: boolean;
    OR: Array<{ userId: string } | { userId: null }>;
  } = {
    OR: [{ userId: user.id }, { userId: null }],
  };
  if (category && isValidCategory(category)) {
    where.category = category;
  }
  if (enabledParam === "true") {
    where.enabled = true;
  } else if (enabledParam === "false") {
    where.enabled = false;
  }

  const rules = await prisma.transformationRule.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RuleCreateBody;
  try {
    body = (await req.json()) as RuleCreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isValidCategory(body.category)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const configCheck = validateConfig(body.config);
  if (!configCheck.ok) {
    return NextResponse.json({ error: configCheck.error }, { status: 400 });
  }
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

  const rule = await prisma.transformationRule.create({
    data: {
      userId: user.id,
      name,
      category: body.category,
      enabled,
      config: JSON.stringify(configCheck.config),
    },
  });

  return NextResponse.json({ rule });
}
