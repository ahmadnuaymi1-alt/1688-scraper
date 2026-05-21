/**
 * probe-patchright-higgsfield.ts — SIDE PROBE (does not touch production).
 *
 * Tests whether driving Higgsfield with **patchright** (a Node-native, drop-in
 * patched Playwright that closes the CDP `Runtime.Enable` fingerprint leak that
 * `puppeteer-extra-plugin-stealth` misses) makes the "Slide right to secure
 * your access" verification wall appear LESS OFTEN than the production
 * `playwright-extra` + stealth-plugin setup.
 *
 * It runs the real Higgsfield generation flow by REUSING the exported helpers
 * from `_higgsfield-lifestyle.ts` — only the browser-launch + stealth engine is
 * different. Production scripts are untouched and keep using playwright-extra.
 *
 * Isolation: uses its OWN persistent profile dir
 * (<tmp>/scene/higgsfield-session-patchright) so it never disturbs the
 * production Higgsfield session. First run is headed → log in via Gmail once.
 *
 * Usage:
 *   npx tsx scripts/probe-patchright-higgsfield.ts                 (headed, default ref)
 *   npx tsx scripts/probe-patchright-higgsfield.ts --headless
 *   npx tsx scripts/probe-patchright-higgsfield.ts --ref=C:\path\to\image.jpg
 *   npx tsx scripts/probe-patchright-higgsfield.ts --keep-open
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// patchright is a drop-in patched Playwright — same API surface as `playwright`.
import { chromium } from "patchright";
import type { Page } from "@playwright/test";
import {
  HIGGSFIELD_URL,
  waitUntilLoggedIn,
  injectVisibleCursor,
  clearOverlays,
  clearPersistedFormState,
  typePrompt,
  uploadReference,
  clickGenerate,
  collectGeneratedImageUrls,
  waitForNewGeneratedImage,
  setAspectRatio11,
  setResolution2K,
} from "./_higgsfield-lifestyle";
import { hasVerificationWall, solveHiggsfieldSlider } from "./lib/higgsfield-slider";

// Separate profile dir — keeps the production Higgsfield session pristine.
const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session-patchright");
const OUT_DIR = path.join(os.tmpdir(), "scene", "output-patchright");
const NAV_TIMEOUT_MS = 30_000;
const GENERATION_TIMEOUT_MS = 10 * 60_000;

const PROMPTS = [
  {
    slug: "patchright_low_up_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: low, looking up at the fixture.",
  },
  {
    slug: "patchright_side_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: side-3/4 view of the fixture.",
  },
  {
    slug: "patchright_front_angle",
    text: "Put this product in a lifestyle image with an editorial style. Camera angle: conventional eye-level front-facing.",
  },
];

function parseArg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const headless = process.argv.includes("--headless");
  const keepOpen = process.argv.includes("--keep-open");
  const refImage = parseArg("ref") ?? path.join(os.tmpdir(), "scene", "p1", "p1_1.jpg");

  if (!fs.existsSync(refImage)) {
    console.error(`Reference image not found: ${refImage}`);
    console.error(`Pass one explicitly with --ref=C:\\path\\to\\image.jpg`);
    process.exit(1);
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("─".repeat(70));
  console.log("PATCHRIGHT SIDE PROBE — Higgsfield verification-wall test");
  console.log("─".repeat(70));
  console.log(`Engine:        patchright (drop-in patched Playwright)`);
  console.log(`Profile dir:   ${SESSION_DIR}`);
  console.log(`Reference:     ${refImage}`);
  console.log(`Output dir:    ${OUT_DIR}`);
  console.log(`Mode:          ${headless ? "headless" : "headed"}`);
  console.log(`Prompts:       ${PROMPTS.length}`);
  console.log("");

  const runStartedAt = Date.now();

  // patchright applies its own stealth — do NOT stack puppeteer-extra-plugin-stealth,
  // and do NOT pass --disable-blink-features=AutomationControlled (patchright
  // handles automation-flag masking itself; adding it back re-introduces a leak).
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
  });
  // Cast: patchright's Page is structurally the Playwright Page the helpers expect.
  const page = (context.pages()[0] ?? (await context.newPage())) as unknown as Page;

  // Wall-appearance tally — the headline metric of this probe.
  let wallSeen = 0;
  let wallCleared = 0;
  const checkWall = async (label: string): Promise<void> => {
    if (await hasVerificationWall(page)) {
      wallSeen++;
      console.log(`  ⚠ [${label}] verification wall appeared (#${wallSeen}) — attempting solve...`);
      const ok = await solveHiggsfieldSlider(page);
      if (ok) wallCleared++;
    }
  };

  let ok = 0;
  let fail = 0;
  const claimedUrls = new Set<string>();

  try {
    console.log(`Navigating to ${HIGGSFIELD_URL}...`);
    await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(2000);
    if (!headless) await injectVisibleCursor(page);
    await checkWall("post-nav");

    await waitUntilLoggedIn(page, OUT_DIR);
    if (!headless) await injectVisibleCursor(page);
    await checkWall("post-login");

    console.log("\nOne-time setup: aspect ratio 1:1 + resolution 2K");
    await setAspectRatio11(page);
    await setResolution2K(page);

    for (let i = 0; i < PROMPTS.length; i++) {
      const p = PROMPTS[i];
      console.log(`\n[${i + 1}/${PROMPTS.length}] ${p.slug}`);
      try {
        await clearOverlays(page);
        await clearPersistedFormState(page);
        await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(2000);
        if (!headless) await injectVisibleCursor(page);
        await clearOverlays(page);
        await checkWall(`${p.slug}:pre-prompt`);

        await typePrompt(page, p.text, OUT_DIR);
        await uploadReference(page, refImage, OUT_DIR);
        await page.waitForTimeout(2000);

        const beforeUrls = await collectGeneratedImageUrls(page);
        await clickGenerate(page, OUT_DIR);
        // The wall most often fires right after Generate is clicked.
        await page.waitForTimeout(1500);
        await checkWall(`${p.slug}:post-generate`);

        console.log(`  Waiting for generation (up to ${GENERATION_TIMEOUT_MS / 60000} min)...`);
        const newUrl = await waitForNewGeneratedImage(page, beforeUrls, claimedUrls, GENERATION_TIMEOUT_MS, {
          outDir: OUT_DIR,
          slug: p.slug,
          runStartedAt,
        });

        if (!newUrl) {
          fail++;
          console.log(`  ✗ ${p.slug}: no image produced`);
          continue;
        }
        // Download the result as proof the generation completed.
        const outPath = path.join(OUT_DIR, `${p.slug}.png`);
        const res = await context.request.get(newUrl, { timeout: 30_000 });
        if (res.ok()) {
          fs.writeFileSync(outPath, await res.body());
          console.log(`  ✓ ${p.slug}: generated → ${outPath}`);
        } else {
          console.log(`  ✓ ${p.slug}: generated (download HTTP ${res.status()}) → ${newUrl}`);
        }
        ok++;
      } catch (e) {
        fail++;
        console.error(`  ✗ ${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    console.log("");
    console.log("─".repeat(70));
    console.log("PROBE REPORT");
    console.log("─".repeat(70));
    console.log(`Engine:                patchright`);
    console.log(`Generations succeeded: ${ok}/${PROMPTS.length}  (failed: ${fail})`);
    console.log(`Verification wall:     appeared ${wallSeen}×, cleared ${wallCleared}×`);
    console.log(
      wallSeen === 0
        ? `Verdict: the wall did NOT appear this run — promising. Re-run a few times to confirm.`
        : `Verdict: the wall still appeared. Compare this rate against the playwright-extra probes.`,
    );
    console.log("─".repeat(70));

    if (keepOpen) {
      console.log("(--keep-open: browser left open — close it manually.)");
    } else {
      await context.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
