import { acquireSlot } from "./_hf-inflight-gate";

async function main() {
  const cap = process.env.HIGGSFIELD_MAX_INFLIGHT;
  if (!cap) {
    const t0 = Date.now();
    const r = await acquireSlot();
    r();
    console.log(`unset: acquire+release in ${Date.now() - t0}ms (expect ~0, no-op)`);
    console.log("GATE TEST DONE");
    return;
  }
  // cap=2 expected. Hold 2 slots, prove the 3rd blocks, then releases on free.
  const a = await acquireSlot();
  const b = await acquireSlot();
  let thirdResolved = false;
  const third = acquireSlot().then((rel) => { thirdResolved = true; return rel; });
  await new Promise((res) => setTimeout(res, 350));
  console.log(`cap=${cap}: after 350ms thirdResolved=${thirdResolved} (expect false — 3rd blocked)`);
  a(); // free one slot → third should now claim it
  const relC = await third;
  console.log(`cap=${cap}: after freeing one, thirdResolved=${thirdResolved} (expect true — reacquired)`);
  b(); relC();
  console.log("GATE TEST DONE");
}
main().catch((e) => { console.error(e); process.exit(1); });
