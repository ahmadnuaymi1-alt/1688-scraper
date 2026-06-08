/**
 * Full inspect for agent-mode Step 1 — variants, images, productType, description.
 * Read-only.  npx tsx scripts/_agent-inspect-cmq48dfkz.ts
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

const ID = "cmq48dfkz000jw2ik1ziakg6o";

async function main() {
  const prisma = new PrismaClient();
  const r = await prisma.product.findUnique({
    where: { id: ID },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!r) { process.stdout.write("NOT FOUND\n"); await prisma.$disconnect(); return; }

  process.stdout.write(`=== PRODUCT ${ID} ===\n`);
  process.stdout.write(`title: ${r.title}\n`);
  process.stdout.write(`productType: ${JSON.stringify(r.productType)}\n`);
  process.stdout.write(`optionNames: ${JSON.stringify(r.optionNames)}\n`);
  process.stdout.write(`status: ${r.status}\n`);
  process.stdout.write(`tags: ${r.tags}\n`);
  process.stdout.write(`vendor: ${r.vendor}\n`);

  const visible = r.variants.filter((v) => !v.isHidden);
  process.stdout.write(`\n=== VARIANTS total=${r.variants.length} visible=${visible.length} hidden=${r.variants.length - visible.length} ===\n`);
  for (const v of r.variants) {
    process.stdout.write(
      `[pos ${v.position}] ${v.isHidden ? "HIDDEN" : "VISIBLE"} | opt1=${JSON.stringify(v.option1)} opt2=${JSON.stringify(v.option2)} | name=${JSON.stringify(v.title ?? "")} | price=${v.price} compareAt=${v.compareAtPrice} | sku=${JSON.stringify(v.sku)} | featuredImageId=${v.featuredImageId ?? "NULL"} | weight=${v.weight}\n`
    );
  }

  process.stdout.write(`\n=== IMAGES total=${r.images.length} ===\n`);
  const byType: Record<string, number> = {};
  for (const im of r.images) {
    const t = im.imageType ?? "null(source)";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  process.stdout.write(`byType: ${JSON.stringify(byType)}\n`);
  // host breakdown for source images
  let alicdn = 0;
  for (const im of r.images) {
    if (im.imageType == null) {
      try { if (new URL(im.url).host.endsWith(".alicdn.com")) alicdn++; } catch {}
    }
  }
  process.stdout.write(`source rows on .alicdn.com: ${alicdn}\n`);
  process.stdout.write(`\n--- first 40 image rows ---\n`);
  for (const im of r.images.slice(0, 40)) {
    let host = "";
    try { host = new URL(im.url).host; } catch { host = "?"; }
    process.stdout.write(`[pos ${im.position}] type=${im.imageType ?? "null"} keep=${im.keep} host=${host} id=${im.id}\n`);
  }

  process.stdout.write(`\n=== DESCRIPTION HTML (length=${(r.descriptionHtml ?? "").length}) ===\n`);
  process.stdout.write((r.descriptionHtml ?? "(empty)") + "\n");

  // rawPayload price peek
  if (r.rawPayload) {
    try {
      const rp = typeof r.rawPayload === "string" ? JSON.parse(r.rawPayload) : r.rawPayload;
      process.stdout.write(`\n=== rawPayload.price ===\n${JSON.stringify(rp?.price ?? rp?.priceInfo ?? "n/a").slice(0, 600)}\n`);
    } catch (e) { process.stdout.write(`\nrawPayload parse err: ${String(e)}\n`); }
  }

  await prisma.$disconnect();
}
main().catch((e) => { process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n"); process.exit(1); });
