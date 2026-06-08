/** List original image URLs for cmq48g609000jw2oo2ubz3vrm (read-only). */
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
const PID = "cmq48g609000jw2oo2ubz3vrm";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";
function pubUrl(sp: string | null | undefined, su: string | null | undefined): string {
  if (sp && SUPABASE_URL) return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${sp}`;
  return su ?? "";
}
(async () => {
  const p = new PrismaClient();
  try {
    const images = await p.productImage.findMany({
      where: { productId: PID }, orderBy: { position: "asc" },
      select: { id: true, position: true, storagePath: true, sourceUrl: true },
    });
    for (const im of images) console.log(`#${String(im.position).padStart(2)} ${pubUrl(im.storagePath, im.sourceUrl)}`);
  } finally { await p.$disconnect(); }
})();
