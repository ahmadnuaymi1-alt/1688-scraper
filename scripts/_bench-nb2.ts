/**
 * Pure timing benchmark for nano-banana-2 (Gemini 3.1 Flash Image) via kie.
 * Runs 6 parallel hero generations using the same prompt + source images as
 * the gpt-image-2 test, uploads outputs to heroes-test-nb2/ (no DB writes).
 * Reports per-call and total wall time.
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const KIE_API_KEY = process.env.KIE_API_KEY!;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const HERO_PROMPT = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/_hero-gpt-oneoff.ts"),
  "utf-8",
).match(/const HERO_PROMPT = `([\s\S]*?)`;/)![1];

const PRODUCT_ID = "cmp89ujrh00bcw26gma7aiml1";

async function fetchSources(): Promise<Array<{ label: string; url: string }>> {
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) throw new Error("product not found");
  const nonHero = product.images.filter((i) => i.imageType !== "hero");
  const imgsById = new Map(nonHero.map((i) => [i.id, i]));
  const variantToImg = new Map<string, (typeof nonHero)[number]>();
  for (const img of nonHero) {
    if (img.variantId && !variantToImg.has(img.variantId)) variantToImg.set(img.variantId, img);
  }
  for (const v of product.variants) {
    if (variantToImg.has(v.id)) continue;
    if (v.featuredImageId) {
      const img = imgsById.get(v.featuredImageId);
      if (img) variantToImg.set(v.id, img);
    }
  }
  const seen = new Set<string>();
  const out: Array<{ label: string; url: string }> = [];
  for (const v of product.variants) {
    const src = variantToImg.get(v.id);
    if (!src) continue;
    const key = src.storagePath || src.sourceUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: (v.option1 ?? "var").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30),
      url: src.storagePath
        ? getSupabase().storage.from(BUCKET).getPublicUrl(src.storagePath).data.publicUrl
        : src.sourceUrl,
    });
  }
  await prisma.$disconnect();
  return out;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function uploadToSupabase(buf: Buffer, storagePath: string): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function callNb2(sourceUrl: string, label: string, started: number): Promise<Buffer> {
  const createRes = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nano-banana-2",
      input: {
        prompt: HERO_PROMPT,
        image_input: [sourceUrl],
        aspect_ratio: "1:1",
        output_format: "png",
      },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`createTask HTTP ${createRes.status}: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { data?: { taskId?: string } };
  const taskId = created.data?.taskId;
  if (!taskId) throw new Error(`No taskId: ${JSON.stringify(created)}`);

  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await (
      await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      })
    ).json();
    const state = poll.data?.state;
    if (state === "success") {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  [${label}] ✓ kie done in ${elapsed}s wall`);
      const rj = JSON.parse(poll.data.resultJson);
      return await downloadBuffer(rj.resultUrls[0]);
    }
    if (state === "fail") {
      throw new Error(`kie failed: ${poll.data?.failMsg ?? "unknown"}`);
    }
  }
  throw new Error("kie timeout");
}

async function main() {
  console.log(`Prompt length: ${HERO_PROMPT.length} chars`);
  console.log(`Fetching variant source URLs from DB ...`);
  const sources = await fetchSources();
  console.log(`Found ${sources.length} unique sources`);
  console.log(`Running ${sources.length} nano-banana-2 calls in parallel ...\n`);

  const startAll = Date.now();
  const settled = await Promise.allSettled(
    sources.map(async (s) => {
      const buf = await callNb2(s.url, s.label, startAll);
      const url = await uploadToSupabase(buf, `heroes-test-nb2/${s.label}.png`);
      return { label: s.label, url };
    }),
  );
  const totalS = ((Date.now() - startAll) / 1000).toFixed(1);

  console.log(`\n========== nano-banana-2 BENCHMARK ==========`);
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      console.log(`  ${r.value.label}: ${r.value.url}`);
    } else {
      console.log(`  ${sources[i].label}: FAIL — ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }
  const okCount = settled.filter((r) => r.status === "fulfilled").length;
  console.log(
    `\nSucceeded: ${okCount}/${sources.length}  Total wall time: ${totalS}s`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
