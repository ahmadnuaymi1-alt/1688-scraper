import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

const ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "BRIGHT_DATA_TOKEN",
  "BRIGHT_DATA_ZONE",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "SESSION_SECRET",
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_ADMIN_TOKEN",
] as const;

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status: Record<string, boolean> = {};
  for (const key of ENV_VARS) {
    const value = process.env[key];
    status[key] = typeof value === "string" && value.length > 0;
  }
  return NextResponse.json({ status });
}
