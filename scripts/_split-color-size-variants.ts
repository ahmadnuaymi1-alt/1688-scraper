/**
 * Split the combined "Color & Size" axis on product cmpwtdpb5005uw29gk3uft7k8
 * into two separate axes: Color (option1) + Size (option2).
 * Variant values are like "White 23.5"" -> color "White", size "23.5"".
 */
import fs from "node:fs"; import path from "node:path"; import { PrismaClient } from "@prisma/client";
function loadEnv(){const p=path.resolve(process.cwd(),".env.local");if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const m=t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}
loadEnv();
const PID="cmpwtdpb5005uw29gk3uft7k8";
const prisma=new PrismaClient();
(async()=>{
  const variants=await prisma.variant.findMany({where:{productId:PID},orderBy:{position:"asc"},select:{id:true,option1:true,option2:true,option3:true}});
  let n=0;
  for(const v of variants){
    const combined=(v.option1??"").trim();
    const m=combined.match(/^(White|Black|Gold|Silver|Brass|Chrome|Grey|Gray)\s+(.+)$/i);
    if(!m){ console.log(`  ! could not parse "${combined}" — skipped`); continue; }
    const color=m[1]; const size=m[2].trim();
    await prisma.variant.update({where:{id:v.id},data:{option1:color, option2:size, option3:null, title:`${color} / ${size}`}});
    console.log(`  "${combined}" -> Color="${color}", Size="${size}"`);
    n++;
  }
  await prisma.product.update({where:{id:PID},data:{optionNames:JSON.stringify(["Color","Size"])}});
  console.log(`Updated ${n} variants; optionNames -> ["Color","Size"]`);
  await prisma.$disconnect();
})();
