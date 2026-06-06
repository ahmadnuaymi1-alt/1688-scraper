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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
(async () => {
  const p = new PrismaClient();
  const rule = await p.transformationRule.findUnique({ where: { id: "cmp30839w002gw2o4rm24nsc4" }, select: { name: true, config: true } });
  if (!rule) { console.log("rule not found"); process.exit(0); }
  const cfg = JSON.parse(rule.config) as { prompt: string; model: string };
  console.log("rule:", rule.name);
  console.log("model:", cfg.model);
  console.log("prompt length:", cfg.prompt.length);
  // Find sections related to specifications / weight
  const idx = cfg.prompt.toLowerCase().indexOf("specification");
  if (idx >= 0) {
    console.log("\n--- excerpt around SPECIFICATION ---");
    console.log(cfg.prompt.slice(Math.max(0, idx - 100), idx + 2000));
  }
  // Show ALL weight mentions with bigger context.
  const lower = cfg.prompt.toLowerCase();
  let idx2 = 0;
  let n = 0;
  while ((idx2 = lower.indexOf("weight", idx2)) >= 0 && n < 8) {
    console.log(`\n--- weight mention #${n + 1} at ${idx2} ---`);
    console.log(cfg.prompt.slice(Math.max(0, idx2 - 200), idx2 + 500));
    idx2 += 6;
    n++;
  }
  await p.$disconnect();
})();
