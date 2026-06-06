/**
 * Mint a fresh Shopify Admin API access token via client_credentials grant
 * for the Vilvida store, then update the stored accessToken on the
 * ShopifyConnection row.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const prisma = new PrismaClient();
  const conn = await prisma.shopifyConnection.findFirst({
    where: { label: "Vilvida" },
    select: { id: true, storeDomain: true, clientId: true, clientSecret: true },
  });
  if (!conn) { console.log("No Vilvida connection"); process.exit(1); }
  if (!conn.clientId || !conn.clientSecret) {
    console.log(`Missing clientId/clientSecret on Vilvida connection — cannot mint`);
    process.exit(1);
  }
  console.log(`Minting token for ${conn.storeDomain}…`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: conn.clientId,
    client_secret: conn.clientSecret,
  }).toString();

  const res = await fetch(`https://${conn.storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  const json = JSON.parse(text) as { access_token: string; scope?: string; expires_in?: number };
  console.log(`Got token: ${json.access_token.slice(0, 12)}… scope=${json.scope ?? "?"} expires_in=${json.expires_in ?? "?"}s`);
  await prisma.shopifyConnection.update({
    where: { id: conn.id },
    data: { accessToken: json.access_token },
  });
  console.log(`Updated ShopifyConnection.accessToken`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
