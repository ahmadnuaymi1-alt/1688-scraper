import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

interface ConnectionCreateBody {
  label?: unknown;
  storeDomain?: unknown;
  accessToken?: unknown;
  // Custom App credentials path: server exchanges them for an access token
  // via Shopify's client_credentials grant, persists ONLY the token.
  clientId?: unknown;
  clientSecret?: unknown;
  isDefault?: unknown;
}

function isValidAccessToken(token: string): boolean {
  return token.startsWith("shpat_") || token.startsWith("shpca_");
}

/**
 * Exchange a Custom App's client_id + client_secret for an Admin API access
 * token via Shopify's OAuth client_credentials grant. Throws with the
 * verbatim Shopify error body (truncated) if the grant fails so the user
 * can diagnose bad creds or a wrong storeDomain immediately.
 */
async function exchangeForAccessToken(
  storeDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const url = `https://${storeDomain.replace(/^https?:\/\//, "")}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Shopify client_credentials grant failed (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  let parsed: { access_token?: unknown };
  try {
    parsed = JSON.parse(body) as { access_token?: unknown };
  } catch {
    throw new Error(`Shopify returned non-JSON response: ${body.slice(0, 300)}`);
  }
  const token = typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!token) {
    throw new Error(`Shopify response missing access_token field: ${body.slice(0, 300)}`);
  }
  return token;
}

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.shopifyConnection.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ connections });
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ConnectionCreateBody;
  try {
    body = (await req.json()) as ConnectionCreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const storeDomain = typeof body.storeDomain === "string" ? body.storeDomain.trim() : "";
  const pastedAccessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
  const isDefault = typeof body.isDefault === "boolean" ? body.isDefault : false;

  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!storeDomain) {
    return NextResponse.json({ error: "storeDomain is required" }, { status: 400 });
  }

  // Resolve the access token via one of two paths:
  //   1. accessToken pasted directly → validate prefix, use as-is.
  //   2. clientId + clientSecret → server-side OAuth client_credentials grant
  //      against the store, persist the returned access_token.
  // The credentials are NEVER stored; only the resolved token is.
  let accessToken: string;
  if (pastedAccessToken) {
    if (!isValidAccessToken(pastedAccessToken)) {
      return NextResponse.json(
        { error: "accessToken must start with shpat_ or shpca_" },
        { status: 400 },
      );
    }
    accessToken = pastedAccessToken;
  } else if (clientId && clientSecret) {
    try {
      accessToken = await exchangeForAccessToken(storeDomain, clientId, clientSecret);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Token exchange failed" },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      {
        error:
          "Provide either `accessToken` OR both `clientId` and `clientSecret`",
      },
      { status: 400 },
    );
  }

  // If isDefault is true, clear other defaults first.
  if (isDefault) {
    await prisma.shopifyConnection.updateMany({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false },
    });
  }

  const connection = await prisma.shopifyConnection.create({
    data: {
      userId: user.id,
      label,
      storeDomain,
      accessToken,
      isDefault,
    },
  });
  return NextResponse.json({ connection });
}
