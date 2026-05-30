/**
 * Backfill the existing Vilvida ShopifyConnection with client_id + client_secret
 * so the uploader can auto-refresh the access token on 401. Also mints a
 * fresh token immediately so today's bulk upload works.
 *
 * One-time script. Hardcoded creds intentional — same workflow the user
 * would do via the new PATCH /api/connections endpoint, but DB-direct.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { exchangeForAccessToken } from "../src/lib/shopify/token-exchange";

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

const VILVIDA_CLIENT_ID = "e4847091eb24d6c5405da1beb10da72d";
const VILVIDA_CLIENT_SECRET = "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";

const prisma = new PrismaClient();
(async () => {
  const conn = await prisma.shopifyConnection.findFirst({
    where: { label: "Vilvida" },
    select: { id: true, label: true, storeDomain: true, accessToken: true },
  });
  if (!conn) {
    console.error("No Vilvida connection found");
    process.exit(1);
  }
  console.log(`Found connection ${conn.id}  store=${conn.storeDomain}  oldToken=${conn.accessToken.slice(0, 10)}...`);

  console.log(`Exchanging client_credentials for fresh access token...`);
  const newToken = await exchangeForAccessToken(
    conn.storeDomain,
    VILVIDA_CLIENT_ID,
    VILVIDA_CLIENT_SECRET,
  );
  console.log(`Got fresh token: ${newToken.slice(0, 10)}...`);

  await prisma.shopifyConnection.update({
    where: { id: conn.id },
    data: {
      clientId: VILVIDA_CLIENT_ID,
      clientSecret: VILVIDA_CLIENT_SECRET,
      accessToken: newToken,
    },
  });
  console.log(`Updated connection ${conn.id}: clientId + clientSecret persisted, accessToken refreshed.`);
  await prisma.$disconnect();
})();
