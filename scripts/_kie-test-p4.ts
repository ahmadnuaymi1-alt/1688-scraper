/**
 * ONE-OFF COMPARISON TEST — safe to delete after viewing the output.
 *
 * Generates 6 lifestyle images for product cmph9kvuf00muw20gqmtk0bc0 (P4) by
 * calling Kie.ai's nano-banana-pro image-to-image endpoint directly, instead
 * of driving Higgsfield's web UI via Playwright. Uses the SAME six scene
 * prompts already authored in scene-overrides/cmph9kvuf00muw20gqmtk0bc0.json
 * and the SAME variant-ref cycling logic as scripts/_lifestyle-image-creator.ts.
 *
 * Does NOT touch the DB or Supabase. Does NOT modify the locked Higgsfield
 * wrapper. Outputs land in kie-test-output/<slug>.png for side-by-side
 * comparison with the Higgsfield-generated lifestyles already attached to P4.
 *
 * Usage:
 *   KIE_API_KEY=xxx npx tsx scripts/_kie-test-p4.ts
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const KIE_KEY = process.env.KIE_API_KEY;
if (!KIE_KEY) {
  console.error("KIE_API_KEY env var not set");
  process.exit(1);
}
const PRODUCT_ID = "cmph9kvuf00muw20gqmtk0bc0";
const OUT_DIR = path.resolve(process.cwd(), "kie-test-output");
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const COUNT = 6;
const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL = "https://api.kie.ai/api/v1/jobs/recordInfo";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicSupabaseUrl(p: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `Output dir: ${path.relative(process.cwd(), OUT_DIR)} (created)`,
  );

  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!product) {
    console.error(`Product ${PRODUCT_ID} not found`);
    process.exit(1);
  }
  console.log(`Product: ${product.title.slice(0, 60)}`);

  // Mirror the heroPool logic from _lifestyle-image-creator.ts
  const imagesById = new Map(product.images.map((i) => [i.id, i]));
  const seenPaths = new Set<string>();
  const heroPool: Array<{
    url: string;
    variantPos: number;
    variantTitle: string;
  }> = [];
  for (const v of product.variants) {
    const img =
      (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined) ??
      product.images.find((pi) => pi.variantId === v.id) ??
      product.images[0];
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl;
    if (!key || seenPaths.has(key)) continue;
    seenPaths.add(key);
    heroPool.push({
      url: img.storagePath
        ? publicSupabaseUrl(img.storagePath)
        : (img.sourceUrl ?? ""),
      variantPos: v.position,
      variantTitle: v.title,
    });
    console.log(`  ref ← variant pos ${v.position} (${v.title.slice(0, 40)})`);
  }
  if (heroPool.length === 0) {
    console.error("No reference image found for any visible variant.");
    process.exit(1);
  }
  console.log(
    `\nUnique reference pool: ${heroPool.length} variant ref(s) — will cycle to ${COUNT} slots.\n`,
  );

  // Load the existing P4 override (same prompts the Higgsfield run used)
  const overridePath = path.resolve(
    process.cwd(),
    "scene-overrides",
    `${PRODUCT_ID}.json`,
  );
  const override = JSON.parse(fs.readFileSync(overridePath, "utf-8")) as {
    scenes: Array<{ slug?: string; prompt: string; variantSlot?: number }>;
  };
  const scenes = override.scenes.slice(0, COUNT);
  console.log(
    `Loaded ${scenes.length} scenes from ${path.relative(process.cwd(), overridePath)}\n`,
  );

  // Submit + poll each scene sequentially (Kie generates fast; sequential is fine)
  const results: Array<{
    slug: string;
    outputPath?: string;
    error?: string;
    elapsedSec?: number;
  }> = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const ref = heroPool[i % heroPool.length];
    const slug = (s.slug && s.slug.trim()) || `scene-${i + 1}`;
    console.log(
      `[${i + 1}/${scenes.length}] ${slug}  (variant pos ${ref.variantPos})`,
    );
    const tStart = Date.now();

    // Submit
    let taskId: string;
    try {
      const submitRes = await fetch(KIE_CREATE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KIE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "nano-banana-pro",
          input: {
            prompt: s.prompt,
            image_input: [ref.url],
            aspect_ratio: "1:1",
            resolution: "2K",
            output_format: "png",
          },
        }),
      });
      const submitData = (await submitRes.json()) as {
        code?: number;
        msg?: string;
        data?: { taskId?: string };
      };
      if (submitData.code !== 200 || !submitData.data?.taskId) {
        console.error(
          `  submit failed: code=${submitData.code} msg=${submitData.msg}`,
        );
        results.push({ slug, error: `submit: ${submitData.msg}` });
        continue;
      }
      taskId = submitData.data.taskId;
      console.log(`  submitted: ${taskId}`);
    } catch (e) {
      console.error(`  submit exception: ${e}`);
      results.push({ slug, error: `submit exception` });
      continue;
    }

    // Poll up to 5 min
    let outputUrl: string | null = null;
    let failMsg: string | null = null;
    const deadline = Date.now() + 5 * 60 * 1000;
    let lastState = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const pollRes = await fetch(`${KIE_POLL}?taskId=${taskId}`, {
          headers: { Authorization: `Bearer ${KIE_KEY}` },
        });
        const pollData = (await pollRes.json()) as {
          data?: {
            state?: string;
            resultJson?: string;
            failMsg?: string;
          };
        };
        const state = pollData.data?.state ?? "?";
        if (state !== lastState) {
          process.stdout.write(`  [${state}]`);
          lastState = state;
        } else {
          process.stdout.write(".");
        }
        if (state === "success") {
          const rj = JSON.parse(pollData.data?.resultJson || "{}") as {
            resultUrls?: string[];
          };
          outputUrl = rj.resultUrls?.[0] ?? null;
          break;
        }
        if (state === "fail") {
          failMsg = pollData.data?.failMsg || "unknown fail";
          break;
        }
      } catch (e) {
        process.stdout.write("X");
      }
    }
    process.stdout.write("\n");

    if (failMsg) {
      console.error(`  FAILED: ${failMsg}`);
      results.push({ slug, error: failMsg });
      continue;
    }
    if (!outputUrl) {
      console.error(`  TIMED OUT after 5 min`);
      results.push({ slug, error: "timeout" });
      continue;
    }

    // Download to local disk
    const outPath = path.join(OUT_DIR, `${slug}.png`);
    try {
      const dlRes = await fetch(outputUrl);
      if (!dlRes.ok) throw new Error(`http ${dlRes.status}`);
      const buf = Buffer.from(await dlRes.arrayBuffer());
      fs.writeFileSync(outPath, buf);
      const elapsedSec = Math.round((Date.now() - tStart) / 1000);
      console.log(
        `  OK → ${path.relative(process.cwd(), outPath)}  (${elapsedSec}s)`,
      );
      results.push({ slug, outputPath: outPath, elapsedSec });
    } catch (e) {
      console.error(`  download failed: ${e}`);
      results.push({ slug, error: `download` });
    }
  }

  // Summary
  console.log("\n========== SUMMARY ==========");
  for (const r of results) {
    console.log(
      r.outputPath
        ? `OK   ${r.slug}  (${r.elapsedSec}s)`
        : `FAIL ${r.slug}: ${r.error}`,
    );
  }
  const ok = results.filter((r) => r.outputPath).length;
  console.log(
    `\n${ok}/${results.length} succeeded. Output: ${path.relative(process.cwd(), OUT_DIR)}/`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
