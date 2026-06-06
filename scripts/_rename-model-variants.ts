/**
 * Rename the "Model A/B/C/D/H" variant values on product cmpwsr41400dtw28cxispu8c8
 * to premium catalog names (the design axis should never show "Model X").
 * Updates option1 + title (token replace) across ALL variants.
 */
import fs from "node:fs"; import path from "node:path"; import { PrismaClient } from "@prisma/client";
function loadEnv(){const p=path.resolve(process.cwd(),".env.local");if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const m=t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}
loadEnv();
const PID="cmpwsr41400dtw28cxispu8c8";
// order longest-first not needed; tokens are distinct "Model X"
const MAP: Record<string,string> = {
  "Model A": "Linea",
  "Model B": "Aura",
  "Model C": "Halo",
  "Model D": "Vista",
  "Model H": "Quadra",
};
function rename(s: string | null): string | null {
  if (!s) return s;
  let out = s;
  for (const [from,to] of Object.entries(MAP)) out = out.split(from).join(to);
  return out;
}
const prisma=new PrismaClient();
(async()=>{
  const variants=await prisma.variant.findMany({where:{productId:PID},select:{id:true,option1:true,title:true}});
  let n=0;
  for(const v of variants){
    const o1=rename(v.option1); const tt=rename(v.title);
    if(o1!==v.option1 || tt!==v.title){
      await prisma.variant.update({where:{id:v.id},data:{option1:o1??undefined,title:tt??undefined}});
      n++;
    }
  }
  console.log(`Renamed ${n}/${variants.length} variants.`);
  // Show resulting LIVE variants
  const live=await prisma.variant.findMany({where:{productId:PID,isHidden:false},orderBy:{position:"asc"},select:{option1:true,option2:true,option3:true}});
  console.log("LIVE now:");
  for(const v of live) console.log(`  [${v.option1}] [${v.option2??""}] [${v.option3??""}]`);
  await prisma.$disconnect();
})();
