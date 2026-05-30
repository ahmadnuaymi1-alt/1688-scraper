/**
 * Find the latest 27 Vilvida-touched products (any upload status), filter to
 * those whose descriptionHtml doesn't follow the rule format (doesn't start
 * with <h2>), re-apply the description TransformationRule to each, then
 * re-upload to Vilvida. Runs server-side via direct service calls — no HTTP
 * layer, no auth, no fire-and-forget.
 *
 *   npx tsx scripts/_fix-vilvida-descriptions.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { reapplyRules } from "../src/services/rule.service";
import { uploadProductToShopify } from "../src/services/uploader.service";

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

function isCompliant(descHtml: string | null): boolean {
  // Rule format: description must begin with <h2> (product type + benefit).
  // Anything else (typically <div>...<p>... or raw text with CJK content) is
  // the un-applied / legacy shape.
  if (!descHtml) return false;
  return descHtml.trimStart().toLowerCase().startsWith("<h2");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const all = await prisma.shopifyConnection.findMany({
      select: { id: true, label: true, storeDomain: true },
    });
    const vilvida =
      all.find((c) => /elveeta|ilvida/i.test(c.label)) ??
      (all.length === 1 ? all[0] : null);
    if (!vilvida) {
      console.error("Could not pick a connection. All:", all.map((c) => c.label));
      process.exit(1);
    }
    console.log(`Connection: ${vilvida.label} (${vilvida.storeDomain})`);

    // De-dupe by productId so the same product (uploaded multiple times)
    // shows up once; take the 27 most recent distinct products.
    const recent = await prisma.uploadRecord.findMany({
      where: { connectionId: vilvida.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        productId: true,
        status: true,
        createdAt: true,
        product: { select: { id: true, title: true, descriptionHtml: true } },
      },
    });
    const seen = new Set<string>();
    const distinct: typeof recent = [];
    for (const u of recent) {
      if (seen.has(u.productId)) continue;
      seen.add(u.productId);
      distinct.push(u);
      if (distinct.length >= 27) break;
    }
    console.log(
      `Examining ${distinct.length} distinct products from the latest upload attempts.`,
    );

    const nonCompliant = distinct.filter((u) => !isCompliant(u.product.descriptionHtml));
    console.log(`\nCompliant (start with <h2>):  ${distinct.length - nonCompliant.length}`);
    console.log(`Non-compliant (need rewrite):  ${nonCompliant.length}`);
    for (const u of nonCompliant) {
      const desc = u.product.descriptionHtml ?? "";
      const hasCJK = /[一-鿿]/.test(desc);
      console.log(
        `  ${u.product.id} [${u.status}]${hasCJK ? " (CJK)" : ""}  "${u.product.title.slice(0, 60)}"`,
      );
    }

    if (nonCompliant.length === 0) {
      console.log("\nAll caught up — nothing to fix.");
      return;
    }

    console.log(`\nRe-applying description rule + re-uploading…`);
    let okReapply = 0;
    let okUpload = 0;
    let failReapply = 0;
    let failUpload = 0;
    for (let i = 0; i < nonCompliant.length; i++) {
      const u = nonCompliant[i];
      const tag = `[${i + 1}/${nonCompliant.length}] ${u.product.id}`;
      const title = u.product.title.slice(0, 60);
      console.log(`\n${tag}  "${title}"`);
      try {
        const t0 = Date.now();
        await reapplyRules(u.product.id, ["description"]);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  ✓ description rule re-applied (${dur}s)`);
        okReapply++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ re-apply failed: ${msg}`);
        failReapply++;
        continue;
      }
      try {
        const t0 = Date.now();
        await uploadProductToShopify(u.product.id, vilvida.id);
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  ✓ re-uploaded to ${vilvida.label} (${dur}s)`);
        okUpload++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ re-upload failed: ${msg}`);
        failUpload++;
      }
    }

    console.log(`\n========== SUMMARY ==========`);
    console.log(`Re-apply  — ${okReapply} ok, ${failReapply} failed`);
    console.log(`Re-upload — ${okUpload} ok, ${failUpload} failed`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
