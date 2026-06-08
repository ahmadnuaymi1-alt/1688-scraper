import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { exchangeForAccessToken } from "@/lib/shopify/token-exchange";

interface ConnectionCreateBody {
  label?: unknown;
  storeDomain?: unknown;
  accessToken?: unknown;
  // Custom App credentials path: server exchanges them for an access token
  // via Shopify's client_credentials grant, persists the credentials so the
  // uploader can refresh the token on 401.
  clientId?: unknown;
  clientSecret?: unknown;
  isDefault?: unknown;
}

function isValidAccessToken(token: string): boolean {
  return token.startsWith("shpat_") || token.startsWith("shpca_");
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
  //      against the store, persist the returned access_token AND the
  //      credentials so the uploader can refresh on 401 expiry.
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
      // Persist credentials when the client_credentials path was used. The
      // uploader's auto-refresh-on-401 path reads these to mint a fresh
      // token without re-prompting the user. When the user pasted a token
      // directly, no credentials are stored (and no auto-refresh is
      // possible — the token will eventually 401 and require manual paste).
      clientId: clientId || null,
      clientSecret: clientSecret || null,
      isDefault,
    },
  });
  return NextResponse.json({ connection });
}

/**
 * PATCH an existing connection — used to attach client_id + client_secret to
 * a connection that was originally created with a pasted-token, so the
 * uploader can start auto-refreshing on its next 401.
 *
 * Body: { id, clientId, clientSecret } — all three required.
 * Also re-runs the grant immediately so the stored accessToken is fresh.
 */
interface ConnectionPatchBody {
  id?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
}

export async function PATCH(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: ConnectionPatchBody;
  try {
    body = (await req.json()) as ConnectionPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
  if (!id || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "id, clientId, and clientSecret are all required" },
      { status: 400 },
    );
  }
  const existing = await prisma.shopifyConnection.findUnique({
    where: { id },
    select: { id: true, userId: true, storeDomain: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (existing.userId && existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let newToken: string;
  try {
    newToken = await exchangeForAccessToken(existing.storeDomain, clientId, clientSecret);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed" },
      { status: 400 },
    );
  }
  const updated = await prisma.shopifyConnection.update({
    where: { id },
    data: { clientId, clientSecret, accessToken: newToken },
  });
  return NextResponse.json({ connection: updated });
}
