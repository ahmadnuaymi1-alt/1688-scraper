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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const p = new PrismaClient();

const IDS = [
  "cmpjstemm004fw2ggzp3ur3wo",
  "cmpjstlof005zw2ggy9gucyhh",
  "cmpjstyid007tw2ggulv0g8b3",
  "cmpjsu8vd009vw2gg63xpg2fv",
  "cmpjsug3l00cpw2gg1r25v59u",
  "cmpjsv24600f9w2ggmzvuyfx3",
  "cmpjsvap800iew2ggixwlxdbn",
  "cmpjsvclt00j5w2ggw4yzlyw5",
  "cmpjswf6e00njw2ggf8fceqtd",
  "cmpjswsmv00rfw2ggb4z2n7tb",
  "cmpjsx9f700thw2gg2r2kiukv",
  "cmpjsxx7n010pw2ggqsx242gf",
  "cmpjsymhx015fw2gg6zf5kp9n",
];

(async () => {
  for (const id of IDS) {
    const product = await p.product.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    const rows = await p.productImage.groupBy({
      by: ["imageType"],
      where: { productId: id },
      _count: { _all: true },
    });
    const byType: Record<string, number> = {};
    for (const r of rows) {
      byType[r.imageType ?? "null"] = r._count._all;
    }
    console.log(
      `${id} | ${JSON.stringify(byType)} | ${(product?.title ?? "").slice(0, 50)}`,
    );
  }
  await p.$disconnect();
})();
