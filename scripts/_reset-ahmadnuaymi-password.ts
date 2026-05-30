import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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

const prisma = new PrismaClient();
const EMAIL = "ahmadnuaymi1@gmail.com";
const NEW_PASSWORD = "Malak2010";

(async () => {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.error(`No user with email ${EMAIL}`);
    process.exit(1);
  }
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  console.log(`Password reset for ${EMAIL} (id ${user.id}). You can now log in with "${NEW_PASSWORD}".`);
  await prisma.$disconnect();
})();
