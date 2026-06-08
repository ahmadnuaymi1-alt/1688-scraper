// IMPORTANT: importing the scraper service auto-registers the scrape + rules
// handlers with the job processor. This must happen BEFORE processNextJob is
// called, so we import it at module scope.
import "@/services/scraper.service";

import { NextResponse } from "next/server";
import { processNextJob } from "@/lib/jobs/processor";

export async function POST() {
  try {
    const result = await processNextJob();
    return NextResponse.json({ processed: result.processed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processor error";
    console.error("[api/jobs/process] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
