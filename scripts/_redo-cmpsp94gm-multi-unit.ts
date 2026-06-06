/**
 * Wipe the 3 most-recent lifestyle ProductImage rows on cmpsp94gm (the 3
 * "plopped" multi-unit images from the earlier top-up — positions 6/7/8,
 * slugs ending _a9e94d / _440812 / _f9a071) and regenerate 3 new ones under
 * the redesigned strategy-driven scene framing. The override file at
 * scene-overrides/cmpsp94gm001nw24cpwbzd5o0.json declares the three new
 * scenes as symmetric-flanking + paired-marker + linear-sequence with named
 * architectural anchors.
 *
 * Single product, so no Promise.all fan-out — just wipe → run → re-apply
 * gallery preset.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

const PRODUCT_ID = "cmpsp94gm001nw24cpwbzd5o0";

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

(async () => {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log(`=== Redo cmpsp94gm multi-unit lifestyles under new framing ===\n`);

  // 1. Find the 3 most-recent lifestyle rows for this product. These are the
  //    "plopped" top-up rows the user rejected.
  const before = await prisma.productImage.findMany({
    where: { productId: PRODUCT_ID, imageType: "lifestyle" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, position: true, fileName: true, storagePath: true, createdAt: true },
  });
  console.log(`Found ${before.length} most-recent lifestyle row(s) to wipe:`);
  for (const r of before) {
    console.log(`  - id=${r.id} pos=${r.position} ${r.fileName} (created ${r.createdAt.toISOString()})`);
  }

  if (before.length > 0) {
    const result = await prisma.productImage.deleteMany({
      where: { id: { in: before.map((r) => r.id) } },
    });
    console.log(`Wiped ${result.count} row(s).\n`);
  }

  // 2. Run the lifestyle creator. The override file is now in place and the
  //    redesigned scene-designer will emit strategy-driven arrangement
  //    clauses for the 3 declared scenes. --only=3 limits to the 3 declared
  //    multi-unit scenes; --no-closeup skips the auto-closeup step (we have
  //    none for this product, but no need to add one in this pass).
  console.log(`Running lifestyle creator (--only=3 --no-closeup)...`);
  const runT0 = Date.now();
  const code = await new Promise<number>((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_lifestyle-image-creator.ts", PRODUCT_ID, "--only=3", "--no-closeup"],
      { stdio: "inherit", shell: true },
    );
    proc.on("close", (c) => resolve(c ?? -1));
    proc.on("error", (err) => {
      console.error(`spawn err: ${err.message}`);
      resolve(-1);
    });
  });
  console.log(`\nLifestyle creator done in ${fmt(Date.now() - runT0)} (exit ${code})`);
  if (code !== 0) {
    console.error("Lifestyle run failed — bailing.");
    await prisma.$disconnect();
    process.exit(1);
  }

  // 3. Re-apply gallery preset so the 3 new lifestyles slot into the gallery.
  console.log(`\n--- Re-applying gallery preset ---`);
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DEV_EMAIL || "ahmadnuaymi1@gmail.com",
      password: process.env.DEV_PASSWORD || "Malak2010",
    }),
  });
  const m = (loginRes.headers.get("set-cookie") || "").match(/scraper_1688_session=[^;]+/);
  if (!m) {
    console.log("  Login failed — apply preset manually via /review/cmpsp94gm001nw24cpwbzd5o0");
  } else {
    const cookie = m[0];
    const presetRes = await fetch(
      `http://localhost:3000/api/products/${PRODUCT_ID}/apply-gallery-preset`,
      { method: "POST", headers: { "Content-Type": "application/json", cookie } },
    );
    console.log(`  preset ${presetRes.status} ${(await presetRes.text()).slice(0, 240)}`);
  }

  // 4. Show the 3 newest lifestyle rows for the user's review.
  const after = await prisma.productImage.findMany({
    where: { productId: PRODUCT_ID, imageType: "lifestyle" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, position: true, fileName: true, sourceUrl: true },
  });
  console.log(`\n=== 3 newest lifestyle rows after run ===`);
  for (const r of after) {
    console.log(`  pos=${r.position}  ${r.fileName}`);
    console.log(`    ${r.sourceUrl}`);
  }

  console.log(`\n=== TOTAL ${fmt(Date.now() - t0)} ===`);
  console.log(`Review URL: http://localhost:3000/review/${PRODUCT_ID}`);

  await prisma.$disconnect();
})();
