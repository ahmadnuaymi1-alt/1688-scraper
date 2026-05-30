/**
 * One-off: sync local ProductImage.fileName + altText to the already-uploaded
 * Shopify products via the `fileUpdate` GraphQL mutation. Matches Shopify
 * media to local images by position order.
 *
 * Usage:
 *   npx tsx scripts/_sync-shopify-image-meta.ts                  # smoke-test + apply to latest 13
 *   npx tsx scripts/_sync-shopify-image-meta.ts --dry-run        # read + match, no writes
 *   npx tsx scripts/_sync-shopify-image-meta.ts --products id1,id2
 */
import fs from "node:fs";
import path from "node:path";
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
import { PrismaClient } from "@prisma/client";

const API_VERSION = "2024-10";

interface GqlResp<T> { data?: T; errors?: Array<{ message: string }> }

function normalizeStoreDomain(d: string): string {
  return d.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function gql<T>(storeDomain: string, token: string, query: string, variables?: Record<string, unknown>): Promise<GqlResp<T>> {
  const url = `https://${normalizeStoreDomain(storeDomain)}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${t.slice(0, 300)}`);
  }
  return r.json() as Promise<GqlResp<T>>;
}

interface MediaNode {
  id: string;
  alt: string | null;
  image?: { id?: string | null; url?: string | null } | null;
  /** MediaImage exposes `mediaContentType: "IMAGE"` and a separate File node
   *  reachable via fragment; the filename is on the File interface. */
  __typename?: string;
}

const PRODUCT_MEDIA_QUERY = `
  query productMedia($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      media(first: 100) {
        edges {
          node {
            ... on MediaImage {
              id
              alt
              image { id url }
            }
          }
        }
      }
    }
  }
`;

const FILE_UPDATE_MUTATION = `
  mutation fileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id alt ... on MediaImage { image { url } } }
      userErrors { field message code }
    }
  }
`;

interface ProductMediaResp {
  product?: {
    id: string;
    title: string;
    handle: string;
    media: { edges: Array<{ node: MediaNode }> };
  } | null;
}

interface FileUpdateResp {
  fileUpdate?: {
    files?: Array<{ id: string; alt: string | null }>;
    userErrors?: Array<{ field?: string[]; message: string; code?: string }>;
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  let productIds: string[] | null = null;
  const pIdx = argv.indexOf("--products");
  if (pIdx >= 0 && argv[pIdx + 1]) {
    productIds = argv[pIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
  }

  const prisma = new PrismaClient();

  // Resolve product list — explicit or latest 13.
  let products: Array<{ id: string; title: string }>;
  if (productIds && productIds.length > 0) {
    const rows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    products = productIds.map((id) => byId.get(id)).filter((p): p is { id: string; title: string } => !!p);
  } else {
    const jobs = await prisma.scrapeJob.findMany({
      where: { product: { isNot: null } },
      orderBy: { createdAt: "desc" },
      take: 13,
      include: { product: { select: { id: true, title: true } } },
    });
    products = jobs.map((j) => j.product!).filter((p): p is { id: string; title: string } => !!p);
  }

  // Find upload records → Shopify product gids.
  const uploads = await prisma.uploadRecord.findMany({
    where: { productId: { in: products.map((p) => p.id) }, status: "success" },
    orderBy: { createdAt: "desc" },
    select: { productId: true, shopifyProductId: true, connectionId: true },
  });
  // Take the most-recent upload per product.
  const latestUpload = new Map<string, { shopifyProductId: string; connectionId: string }>();
  for (const u of uploads) {
    if (!latestUpload.has(u.productId) && u.shopifyProductId) {
      latestUpload.set(u.productId, { shopifyProductId: u.shopifyProductId, connectionId: u.connectionId });
    }
  }

  // Smoke-test the connection (default to first upload's connection, else default).
  const connectionId =
    [...latestUpload.values()][0]?.connectionId ??
    (await prisma.shopifyConnection.findFirst({ where: { isDefault: true } }))?.id ??
    (await prisma.shopifyConnection.findFirst({}))?.id;
  if (!connectionId) {
    console.error("No Shopify connection found.");
    process.exit(1);
  }
  const connection = await prisma.shopifyConnection.findUnique({ where: { id: connectionId } });
  if (!connection) {
    console.error("Connection row vanished.");
    process.exit(1);
  }
  console.log(`Connection: ${connection.label} @ ${connection.storeDomain}`);
  console.log(`Smoke-testing token...`);
  try {
    const r = await gql<{ shop: { name: string } }>(connection.storeDomain, connection.accessToken, "{ shop { name } }");
    if (r.errors?.length) throw new Error(`shop query errors: ${r.errors.map((e) => e.message).join("; ")}`);
    console.log(`  Token OK — shop: ${r.data?.shop?.name}`);
  } catch (e) {
    console.error(`  TOKEN FAIL: ${e instanceof Error ? e.message : String(e)}`);
    console.error(`  Refresh the token in /settings then re-run.`);
    process.exit(1);
  }
  console.log("");

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalProductsTouched = 0;

  for (const p of products) {
    const upload = latestUpload.get(p.id);
    if (!upload) {
      console.log(`  ${p.id}  ${p.title.slice(0, 50)} — no successful upload record, SKIP`);
      continue;
    }
    console.log(`\n=== ${p.id} | shopify=${upload.shopifyProductId} | ${p.title.slice(0, 60)} ===`);
    let resp: GqlResp<ProductMediaResp>;
    try {
      resp = await gql<ProductMediaResp>(connection.storeDomain, connection.accessToken, PRODUCT_MEDIA_QUERY, {
        id: upload.shopifyProductId,
      });
    } catch (e) {
      console.error(`  fetch media FAIL: ${e instanceof Error ? e.message : String(e)}`);
      totalErrors++;
      continue;
    }
    if (resp.errors?.length) {
      console.error(`  fetch media errors: ${resp.errors.map((e) => e.message).join("; ")}`);
      totalErrors++;
      continue;
    }
    const shop = resp.data?.product;
    if (!shop) {
      console.error(`  Shopify product not found (was it deleted?). SKIP`);
      continue;
    }
    const shopifyMedia = shop.media.edges.map((e) => e.node).filter((n) => n.id);
    const local = await prisma.productImage.findMany({
      where: { productId: p.id, downloadStatus: "downloaded" },
      orderBy: { position: "asc" },
      select: { position: true, fileName: true, altText: true, sourceUrl: true, storagePath: true },
    });
    // Mirror the uploader's dedup-by-sourceUrl so positions align with what
    // was actually sent.
    const seen = new Set<string>();
    const localOrdered = local.filter((img) => {
      if (!img.sourceUrl || seen.has(img.sourceUrl)) return false;
      seen.add(img.sourceUrl);
      return true;
    });

    console.log(`  shopify media: ${shopifyMedia.length}  |  local images: ${localOrdered.length}`);
    if (shopifyMedia.length === 0 || localOrdered.length === 0) continue;

    // Pair Shopify[i] ↔ local[i] (positional). Build fileUpdate inputs only
    // for entries where local has a non-empty new filename or altText AND it
    // differs from what's already on Shopify.
    const updates: Array<{ id: string; alt?: string; filename?: string }> = [];
    const n = Math.min(shopifyMedia.length, localOrdered.length);
    for (let i = 0; i < n; i++) {
      const s = shopifyMedia[i];
      const l = localOrdered[i];
      const update: { id: string; alt?: string; filename?: string } = { id: s.id };
      let needs = false;
      const desiredAlt = (l.altText || "").trim();
      if (desiredAlt && desiredAlt !== (s.alt || "")) {
        update.alt = desiredAlt;
        needs = true;
      }
      const desiredFn = (l.fileName || "").trim();
      // Shopify requires the filename to keep the original extension. Append
      // the extension from the existing Shopify URL if our local fileName is
      // missing one.
      let filename = desiredFn;
      if (filename) {
        const hasExt = /\.[A-Za-z0-9]{1,5}$/.test(filename);
        if (!hasExt) {
          const url = s.image?.url ?? "";
          const m = url.match(/\.([A-Za-z0-9]{1,5})(?:\?|$)/);
          const ext = m ? m[1] : "png";
          filename = `${filename}.${ext}`;
        }
        // Shopify rejects spaces and most special chars. Sanitize defensively.
        filename = filename.replace(/[^A-Za-z0-9._-]+/g, "-");
        // Compare against existing URL basename.
        const existingBase = (s.image?.url ?? "").split(/[/?]/).pop()?.split(".")[0] ?? "";
        if (filename.split(".")[0] !== existingBase) {
          update.filename = filename;
          needs = true;
        }
      }
      if (needs) updates.push(update);
      else totalSkipped++;
    }
    console.log(`  ${updates.length} update(s) needed, ${n - updates.length} already match.`);
    if (updates.length === 0) continue;

    if (dryRun) {
      console.log("  --dry-run — would update:");
      for (const u of updates.slice(0, 4)) console.log(`    ${u.id.split("/").pop()}  filename=${u.filename ?? "(no change)"}  alt=${(u.alt ?? "(no change)").slice(0, 60)}`);
      if (updates.length > 4) console.log(`    …and ${updates.length - 4} more`);
      totalUpdated += updates.length;
      continue;
    }

    // fileUpdate takes up to a reasonable batch — Shopify caps at 50. Chunk
    // defensively at 20.
    const chunks: Array<typeof updates> = [];
    for (let i = 0; i < updates.length; i += 20) chunks.push(updates.slice(i, i + 20));
    let okCount = 0;
    let errCount = 0;
    for (const batch of chunks) {
      try {
        const r = await gql<FileUpdateResp>(connection.storeDomain, connection.accessToken, FILE_UPDATE_MUTATION, {
          files: batch,
        });
        if (r.errors?.length) {
          console.error(`    fileUpdate gql errors: ${r.errors.map((e) => e.message).join("; ")}`);
          errCount += batch.length;
          continue;
        }
        const userErrors = r.data?.fileUpdate?.userErrors ?? [];
        if (userErrors.length > 0) {
          for (const ue of userErrors) {
            console.error(
              `    userError: ${ue.message}${ue.code ? ` [${ue.code}]` : ""}${ue.field ? ` (${ue.field.join(".")})` : ""}`,
            );
          }
        }
        const updatedCount = r.data?.fileUpdate?.files?.length ?? 0;
        okCount += updatedCount;
        errCount += batch.length - updatedCount;
      } catch (e) {
        console.error(`    batch FAIL: ${e instanceof Error ? e.message : String(e)}`);
        errCount += batch.length;
      }
    }
    console.log(`  → ${okCount} updated, ${errCount} failed`);
    totalUpdated += okCount;
    totalErrors += errCount;
    totalProductsTouched++;
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Products touched: ${totalProductsTouched}/${products.length}`);
  console.log(`Files updated:    ${totalUpdated}`);
  console.log(`Already in sync:  ${totalSkipped}`);
  console.log(`Failed:           ${totalErrors}`);
  console.log(`Dry run:          ${dryRun}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error("UNHANDLED:", e); process.exit(1); });
