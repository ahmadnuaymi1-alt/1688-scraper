/**
 * ONE-OFF: Test the official Higgsfield CLI for hero generation as a possible
 * replacement for the current Playwright + Kie pipeline.
 *
 * Picks the walnut variant of cmpjstemm004fw2ggzp3ur3wo (pos 7 source image),
 * downloads it locally, then runs:
 *   higgsfield generate create nano_banana_2
 *     --prompt "<HERO_PROMPT from src/lib/hero/prompt.ts>"
 *     --input_images <variant.png>
 *     --input_images <positioning-template.png>
 *     --aspect_ratio 1:1
 *     --resolution 2k
 *     --wait
 *
 * Prints the resulting image URL. Does NOT modify the DB or touch Supabase.
 * Pure test.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { HERO_PROMPT } from "../src/lib/hero/prompt";

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

const PRODUCT_ID = "cmpjstemm004fw2ggzp3ur3wo";
const VARIANT_POSITION = 4; // 胡桃色 (walnut)
const POSITIONING_TEMPLATE = path.join(os.tmpdir(), "scene", "v25-refs", "positioning-template.png");
const OUT_DIR = path.join(os.tmpdir(), "hf-cli-test");

async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`  ↳ ${(buf.length / 1024).toFixed(1)} KB → ${dest}`);
}

function runHiggsfield(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    // Windows Node won't spawn .cmd with shell:false (CVE-2024-27980), but
    // shell:true with an args array gets re-parsed by cmd.exe and corrupts
    // multi-line prompts. Workaround: build the whole command as one string
    // with each arg explicitly double-quoted (inner " escaped as \"\"), then
    // spawn that single string with shell:true.
    const quoted = args
      .map((a) => `"${a.replace(/"/g, '""')}"`)
      .join(" ");
    const cmd = `higgsfield ${quoted}`;
    const proc = spawn(cmd, [], { shell: true });
    let out = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stderr.write(s);
    });
    proc.on("close", (code) => resolve({ code: code ?? -1, out }));
    proc.on("error", (err) => {
      console.error(`spawn error: ${err.message}`);
      resolve({ code: -1, out: err.message });
    });
  });
}

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!p) throw new Error("product not found");
  const v = p.variants.find((x) => x.position === VARIANT_POSITION);
  if (!v) throw new Error(`variant at pos ${VARIANT_POSITION} not found`);
  const refImg =
    p.images.find((i) => i.id === v.featuredImageId) ??
    p.images.find((i) => i.variantId === v.id);
  if (!refImg) throw new Error("no reference image for this variant");
  console.log(`Product: ${p.title.slice(0, 60)}`);
  console.log(`Variant pos ${v.position}: ${v.title.slice(0, 60)}`);
  console.log(`Reference: ${refImg.sourceUrl}`);

  if (!fs.existsSync(POSITIONING_TEMPLATE)) {
    throw new Error(`positioning template missing at ${POSITIONING_TEMPLATE}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const refLocal = path.join(OUT_DIR, "variant-ref.png");
  console.log(`\nDownloading variant ref…`);
  await downloadTo(refImg.sourceUrl, refLocal);

  // Step 2: upload both refs via the CLI's upload command and capture the IDs.
  // The model's input_images array wants objects (likely { id }), not raw paths.
  async function uploadAndGetId(file: string): Promise<string> {
    const r = await runHiggsfield(["upload", "create", file, "--json"]);
    if (r.code !== 0) throw new Error(`upload failed for ${file}: exit ${r.code}`);
    // The --json output is a pretty-printed JSON blob spanning multiple lines.
    // Grab the first { … } block.
    const match = r.out.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error(`no JSON in upload output for ${file}: ${r.out.slice(-200)}`);
    const parsed = JSON.parse(match[0]) as { id?: string };
    if (!parsed.id) throw new Error(`upload returned no id for ${file}: ${match[0]}`);
    return parsed.id;
  }

  console.log(`\nUploading refs to Higgsfield…`);
  const variantId = await uploadAndGetId(refLocal);
  console.log(`  variant-ref → ${variantId}`);
  const templateId = await uploadAndGetId(POSITIONING_TEMPLATE);
  console.log(`  positioning-template → ${templateId}`);

  console.log(`\n=== HIGGSFIELD CLI HERO TEST ===`);
  console.log(`Model: nano_banana_2 (Nano Banana Pro)`);
  console.log(`Inputs: ${refLocal}  +  ${POSITIONING_TEMPLATE}`);
  console.log(`Prompt: ${HERO_PROMPT.length} chars\n`);

  // cmd.exe doesn't survive literal newlines inside quoted args. Collapse
  // newlines into spaces — the prompt's meaning doesn't depend on line breaks.
  const promptOneLine = HERO_PROMPT.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  // The model's input_images param wants an array of upload-reference
  // OBJECTS (the earlier "Input should be a valid object" rejection). Pass
  // each entry as { id: <upload_id> }.
  const inputImagesJson = JSON.stringify([
    { id: variantId, type: "media_input" },
    { id: templateId, type: "media_input" },
  ]);

  const args = [
    "generate",
    "create",
    "nano_banana_2",
    "--prompt",
    promptOneLine,
    "--input_images",
    inputImagesJson,
    "--aspect_ratio",
    "1:1",
    "--resolution",
    "2k",
    "--wait",
  ];

  const tStart = Date.now();
  const result = await runHiggsfield(args);
  const secs = Math.round((Date.now() - tStart) / 1000);
  console.log(`\n=== RESULT ===`);
  console.log(`Exit code: ${result.code}`);
  console.log(`Wall time: ${secs}s`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
