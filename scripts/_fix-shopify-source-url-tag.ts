/**
 * Fix the source-URL tag on every Vilvida product whose tag rule copied the
 * example URL verbatim.
 *
 * For each successful UploadRecord with a shopifyProductId:
 *   1. Pull the live tags from Shopify (productByID).
 *   2. Strip any tag matching a 1688 URL pattern.
 *   3. Add the product's ACTUAL sourceUrl (from ScrapeJob) as a tag.
 *   4. Push back to Shopify via productUpdate.
 *   5. Update Product.tags in the local DB so future re-uploads don't
 *      re-introduce the bad URL.
 *
 * Idempotent: re-running on already-correct products is a no-op (logged as
 * "skip"). Deduped by shopifyProductId so duplicate UploadRecord rows for
 * the same Shopify product only get touched once.
 *
 *   npx tsx scripts/_fix-shopify-source-url-tag.ts
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const SHOPIFY_API_VERSION = "2024-10";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function normalizeStoreDomain(s: string): string {
  if (s.includes("://")) {
    try {
      return new URL(s).hostname;
    } catch {
      return s.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  }
  return s.replace(/\/$/, "");
}

async function shopifyRequest<T>(
  storeDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse<T>> {
  const domain = normalizeStoreDomain(storeDomain);
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GraphQLResponse<T>;
}

const GET_TAGS = `query getTags($id: ID!) {
  product(id: $id) { id tags }
}`;

const UPDATE_TAGS = `mutation updateTags($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id tags }
    userErrors { field message }
  }
}`;

const ONE688_URL = /^https?:\/\/[^\s/]*1688\.com\//i;

function reconcileTags(currentTags: string[], realSourceUrl: string): {
  fixed: string[];
  changed: boolean;
  removed: string[];
} {
  const removed: string[] = [];
  const kept = currentTags.filter((t) => {
    if (ONE688_URL.test(t) && t !== realSourceUrl) {
      removed.push(t);
      return false;
    }
    return true;
  });
  const hasReal = kept.includes(realSourceUrl);
  const fixed = hasReal ? kept : [...kept, realSourceUrl];
  const changed = removed.length > 0 || !hasReal;
  return { fixed, changed, removed };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const conn = await prisma.shopifyConnection.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!conn) {
      console.error("No Shopify connection found.");
      process.exit(1);
    }
    console.log(`Connection: ${conn.label} (${conn.storeDomain})\n`);

    const uploads = await prisma.uploadRecord.findMany({
      where: {
        connectionId: conn.id,
        status: "success",
        shopifyProductId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            scrapeJob: { select: { sourceUrl: true } },
          },
        },
      },
    });
    console.log(`${uploads.length} successful uploads total.`);

    // Dedupe by shopifyProductId — multiple UploadRecord rows can point at the
    // same Shopify product (handle-collision retries on the user side caused
    // duplicate uploads). Touch each Shopify product once.
    const seen = new Set<string>();
    const work: typeof uploads = [];
    for (const u of uploads) {
      const id = u.shopifyProductId!;
      if (seen.has(id)) continue;
      seen.add(id);
      work.push(u);
    }
    console.log(`Deduped to ${work.length} unique Shopify products.\n`);

    let fixed = 0;
    let alreadyCorrect = 0;
    let noSource = 0;
    let failed = 0;

    for (let i = 0; i < work.length; i++) {
      const u = work[i];
      const tag = `[${i + 1}/${work.length}] ${u.shopifyProductId}`;
      const realSource = u.product.scrapeJob?.sourceUrl ?? null;
      if (!realSource) {
        console.log(`${tag}  NO SOURCE  "${u.product.title.slice(0, 50)}"`);
        noSource++;
        continue;
      }
      try {
        const getResp = await shopifyRequest<{
          product: { id: string; tags: string[] } | null;
        }>(conn.storeDomain, conn.accessToken, GET_TAGS, {
          id: u.shopifyProductId,
        });
        const liveTags = getResp.data?.product?.tags ?? [];
        const { fixed: newTags, changed, removed } = reconcileTags(liveTags, realSource);

        if (!changed) {
          console.log(`${tag}  OK         "${u.product.title.slice(0, 50)}"`);
          alreadyCorrect++;
          continue;
        }

        const updResp = await shopifyRequest<{
          productUpdate?: {
            userErrors?: Array<{ field?: string[]; message: string }>;
          };
        }>(conn.storeDomain, conn.accessToken, UPDATE_TAGS, {
          input: { id: u.shopifyProductId, tags: newTags },
        });
        const errs = updResp.data?.productUpdate?.userErrors ?? [];
        if (errs.length > 0) {
          console.error(
            `${tag}  FAIL       userErrors: ${errs.map((e) => e.message).join("; ")}`,
          );
          failed++;
          continue;
        }

        await prisma.product.update({
          where: { id: u.product.id },
          data: { tags: newTags.join(", ") },
        });

        console.log(
          `${tag}  FIXED      removed=${removed.length} now=${newTags.length}  "${u.product.title.slice(0, 50)}"`,
        );
        fixed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag}  ERROR      ${msg}`);
        failed++;
      }
    }

    console.log(
      `\nDone. fixed=${fixed}  already-correct=${alreadyCorrect}  no-source=${noSource}  failed=${failed}  (of ${work.length})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
