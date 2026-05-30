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

const prisma = new PrismaClient();

const URLS = [
  "https://detail.1688.com/offer/1047429367874.html",
  "https://detail.1688.com/offer/741771758011.html",
  "https://detail.1688.com/offer/951322676037.html",
  "https://detail.1688.com/offer/760540451066.html",
];

(async () => {
  for (const url of URLS) {
    const j = await prisma.scrapeJob.findFirst({
      where: { sourceUrl: url },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        product: {
          select: {
            id: true,
            title: true,
            variants: { where: { isHidden: false }, select: { id: true } },
            images: { where: { imageType: { in: ["hero", "hero-flat", "lifestyle"] } }, select: { imageType: true } },
          },
        },
      },
    });
    if (!j) {
      console.log(`${url}  → NO JOB`);
      continue;
    }
    const p = j.product;
    const heroes = p?.images.filter((i) => i.imageType === "hero" || i.imageType === "hero-flat").length ?? 0;
    const lifestyles = p?.images.filter((i) => i.imageType === "lifestyle").length ?? 0;
    console.log(
      `${url}\n  job=${j.status.padEnd(8)} productId=${p?.id ?? "—"} variants=${p?.variants.length ?? 0} heroes=${heroes} lifestyles=${lifestyles}\n  title="${(p?.title ?? "").slice(0, 70)}"`,
    );
  }
  await prisma.$disconnect();
})();
