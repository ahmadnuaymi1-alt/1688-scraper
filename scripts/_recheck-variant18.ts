import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
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

const PROMPT = `Look at this watch hero image. Reply ONLY with strict minified JSON:
{"plastic_stand":"yes|no","detail":"one line"}.
Specifically: is there any clear plastic display stand, transparent acrylic holder, perspex prop, plastic watch cradle, or any visible support structure under the watch?`;

(async () => {
  const p = new PrismaClient();
  const v = await p.variant.findFirst({
    where: { productId: "cmq3nwk6g000jw2hst5cwxfj8", position: 18 },
    select: { featuredImage: { select: { sourceUrl: true } } },
  });
  const url = v?.featuredImage?.sourceUrl;
  if (!url) { console.log("no image"); process.exit(1); }
  const res = await fetch(url);
  const ct = res.headers.get("content-type") || "image/png";
  const mime = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: buf.toString("base64") } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_VISION_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
  console.log("Vision says:", text);
  await p.$disconnect();
})();
