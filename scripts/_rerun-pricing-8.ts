import fs from "node:fs"; import path from "node:path";
function loadEnv(){const p=path.resolve(process.cwd(),".env.local");if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const m=t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}
loadEnv();
import { recalculatePricing, applyPricingToVariants } from "../src/services/pricing.service";
import { DEFAULT_SCRAPE_OPTIONS } from "../src/types/scrape-options";
import { PrismaClient } from "@prisma/client";

const IDS = ["cmpwthbey00qnw28cnvbi9x0p","cmpwtf8ds00inw29ghs56kiq8","cmpwtecja00d6w29g9uja9sy2","cmpwte53l00bhw29gm0ue8mvq","cmpwtdpjy0068w29g0b34xfts","cmpwtdpb5005uw29gk3uft7k8","cmpwtdkke003yw29gb0h63g82","cmpwtdi8w002xw29gav950lny"];
const prisma = new PrismaClient();
async function waitForDb(){ for(let i=0;i<6;i++){ try{ await prisma.product.count(); return true;}catch{ console.log(`  DB not up yet (try ${i+1}/6), waiting 10s...`); await new Promise(r=>setTimeout(r,10000)); } } return false; }
function makeLimit(c:number){ let active=0; const q:Array<()=>void>=[]; return async <T>(fn:()=>Promise<T>):Promise<T>=>{ if(active>=c) await new Promise<void>(r=>q.push(r)); active++; try{ return await fn(); } finally{ active--; const n=q.shift(); if(n)n(); } }; }
(async()=>{
  if(!(await waitForDb())){ console.log("DB STILL DOWN after ~60s — aborting, no changes made."); await prisma.$disconnect(); process.exit(2); }
  console.log("DB up. Pricing 8 products (concurrency 3)...");
  const limit = makeLimit(3);
  const results = await Promise.all(IDS.map(id=>limit(async()=>{ const t0=Date.now();
    try{ const r=await recalculatePricing(id,DEFAULT_SCRAPE_OPTIONS); await applyPricingToVariants(id,"launch",DEFAULT_SCRAPE_OPTIONS); const v=await prisma.variant.findMany({where:{productId:id,isHidden:false},orderBy:{position:"asc"},select:{price:true}}); const prices=[...new Set(v.map(x=>x.price))].sort((a,b)=>parseFloat(a)-parseFloat(b)); return {id,ok:true,prices,sat:r.marketSaturated,notes:r.notes,sec:Math.round((Date.now()-t0)/1000)}; }
    catch(e){ return {id,ok:false,err:e instanceof Error?e.message:String(e),sec:Math.round((Date.now()-t0)/1000)}; } })));
  const tm=Object.fromEntries((await prisma.product.findMany({where:{id:{in:IDS}},select:{id:true,title:true}})).map(p=>[p.id,p.title]));
  console.log("\n========= RESULTS =========");
  for(const r of results){ const t=(tm[r.id]||"").slice(0,46); if(r.ok) console.log(`OK [${r.sec}s] ${t}\n   ${r.prices.map(p=>'$'+parseFloat(p)).join(' / ')} ${r.sat?'(saturated)':''}\n   ${(r.notes||'').slice(0,150)}`); else console.log(`FAIL [${r.sec}s] ${t}\n   ${(r.err||'').split('\n')[0].slice(0,150)}`); }
  await prisma.$disconnect();
})().catch(e=>{console.error("UNHANDLED:",e instanceof Error?e.message:e);process.exit(1);});
