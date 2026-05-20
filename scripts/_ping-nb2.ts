import fs from "node:fs";
import path from "node:path";

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
const SOURCE = "https://cbu01.alicdn.com/img/ibank/O1CN01l4U9Q42AX9UzIaz1x_!!2218665968212-0-cib.jpg";
const PROMPT = "test prompt for model identifier probe";

async function main() {
  // User wants Google's Gemini 3.1 Flash Image model
  const candidates = [
    "gemini-3.1-flash-image",
    "gemini-3-flash-image",
    "google/gemini-3.1-flash-image",
    "gemini-flash-image",
    "nano-banana-flash",
    "nano-banana-2",
    "nano-banana",
  ];

  for (const model of candidates) {
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: { prompt: PROMPT, image_input: [SOURCE], aspect_ratio: "1:1", output_format: "png" },
      }),
    });
    const body = await res.text();
    const accepted = res.ok && body.includes("taskId");
    console.log(`${accepted ? "✓" : "✗"} ${model}  →  HTTP ${res.status}  ${body.slice(0, 200)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
