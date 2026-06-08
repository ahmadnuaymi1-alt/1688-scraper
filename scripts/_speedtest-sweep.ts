import fs from "node:fs";
import path from "node:path";
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

const IDS = [
  ["p1 jbox",      "cmq489vf3000jw2dolzoxx5ks"],
  ["p2 jbox-lock", "cmq48l750000jw25kdq7dicq4"],
  ["p3 jbox-waln", "cmq48cyg3000jw2g46nf689gj"],
  ["p4 jbox-pu",   "cmq48dfkz000jw2ik1ziakg6o"],
  ["p5 watch-dcal","cmq48d1ju000jw2gowuwbmolt"],
  ["p6 necklace",  "cmq48d6pa000jw2fw81cyt2gy"],
  ["p7 watch-rose","cmq48cv6c000jw2p0nju9lm7r"],
  ["p8 watch-6h",  "cmq48g609000jw2oo2ubz3vrm"],
];

async function main() {
  const prisma = new PrismaClient();
  console.log("label         | type        | varV/T | hero | life | clos | aliveOrig | descLen | $sample | status");
  for (const [label, id] of IDS) {
    try {
      const p: any = await prisma.product.findUnique({ where: { id }, include: { variants: true, images: true } });
      if (!p) { console.log(`${label.padEnd(13)} | NOT FOUND`); continue; }
      const t = (k: string) => p.images.filter((i: any) => (i.imageType ?? "(source)") === k).length;
      const hero = t("hero-flat") + t("hero");
      const life = t("lifestyle");
      const clos = t("closeup");
      const aliveOrig = p.images.filter((i: any) => i.imageType === null && (() => { try { return new URL(i.sourceUrl).hostname.endsWith(".alicdn.com"); } catch { return false; } })()).length;
      const visV = p.variants.filter((v: any) => !v.isHidden).length;
      const price = p.variants.find((v: any) => !v.isHidden)?.price ?? "?";
      const descLen = (p.descriptionHtml ?? "").length;
      const issues: string[] = [];
      if (hero < 1) issues.push("NO-HERO");
      if (life !== 6) issues.push(life > 6 ? `DUP-LIFE(${life})` : `LOW-LIFE(${life})`);
      if (clos < 1) issues.push("NO-CLOSEUP");
      if (aliveOrig > 0) issues.push(`UNDELETED(${aliveOrig})`);
      const status = issues.length ? issues.join(",") : "OK";
      console.log(`${label.padEnd(13)} | ${String(p.productType).padEnd(11)} | ${visV}/${p.variants.length}    | ${String(hero).padStart(2)}   | ${String(life).padStart(2)}   | ${String(clos).padStart(2)}   | ${String(aliveOrig).padStart(3)}       | ${String(descLen).padStart(5)}   | $${price.toString().padEnd(5)} | ${status}`);
    } catch (e) {
      console.log(`${label.padEnd(13)} | ERROR ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
