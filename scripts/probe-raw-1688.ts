import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const SOURCE_URL = process.env.SOURCE_URL!;
  const token = process.env.BRIGHT_DATA_TOKEN!;
  const zone = process.env.BRIGHT_DATA_ZONE!;

  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ zone, url: SOURCE_URL, format: "raw" }),
  });
  const html = await res.text();
  console.log(`Body length: ${html.length}`);

  // Title attempts
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) console.log("DOC TITLE:", titleMatch[1].trim());
  const subjectMatch = html.match(/"subject"\s*:\s*"([^"]+)"/);
  if (subjectMatch) console.log("SUBJECT:", subjectMatch[1]);
  const offerTitleMatch = html.match(/"offerTitle"\s*:\s*"([^"]+)"/);
  if (offerTitleMatch) console.log("OFFER TITLE:", offerTitleMatch[1]);
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
  if (og) console.log("OG TITLE:", og[1]);

  // Image URLs — capture all cbu01 jpgs
  const imgSet = new Set<string>();
  const re = /https?:\/\/cbu01\.alicdn\.com\/img\/ibank\/[^"'\s)]+\.(?:jpg|jpeg|png)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    imgSet.add(m[0]);
    if (imgSet.size >= 30) break;
  }
  console.log(`Found ${imgSet.size} unique image URLs:`);
  let i = 0;
  for (const u of imgSet) {
    console.log(`  [${++i}] ${u}`);
    if (i >= 15) break;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
