/**
 * Save point for the 5/28/2026 batch ("make this") — dumps a complete JSON
 * snapshot of all 9 fan-light products + their variants + ProductImages +
 * scrapeJob options + pricingNotes so we can revert if later edits go bad.
 *
 * Storage: snapshots/savepoint-2026-05-28-make-this.json (one file per save
 * point, atomic — we just write the file).
 *
 * To revert: run scripts/_savepoint-restore.ts <path-to-snapshot.json>
 * (not yet written — only needed if/when we need to revert).
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

const IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqhueh00amw2vsdewbgxhs",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqgin7004cw2vs04697sgd",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppv6kdl00rjw2vsnhsp6sqn",
  "cmppv892200t9w2vsh5vgmgmg",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

(async () => {
  const snapshot: {
    label: string;
    createdAt: string;
    products: unknown[];
  } = {
    label: "2026-05-28 — make this",
    createdAt: new Date().toISOString(),
    products: [],
  };

  for (const id of IDS) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        scrapeJob: true,
        variants: { orderBy: { position: "asc" } },
        images: { orderBy: { position: "asc" } },
      },
    });
    if (!product) {
      console.warn(`  ${id} not found`);
      continue;
    }
    snapshot.products.push(product);
    const heroes = product.images.filter(
      (i) => i.imageType === "hero" || i.imageType === "hero-flat",
    ).length;
    const lifestyles = product.images.filter((i) => i.imageType === "lifestyle").length;
    console.log(
      `  ${id}  variants=${product.variants.length}  images=${product.images.length}  heroes=${heroes}  lifestyles=${lifestyles}  title="${(product.title ?? "").slice(0, 50)}"`,
    );
  }

  const dir = path.resolve("snapshots");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "savepoint-2026-05-28-make-this.json");
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSave point written: ${outPath}`);
  console.log(`  ${snapshot.products.length} product(s) snapshotted, ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

  await prisma.$disconnect();
})();
