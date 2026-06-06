import fs from "node:fs"; import path from "node:path"; import os from "node:os";
function loadEnv(){const p=path.resolve(process.cwd(),".env.local");if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const m=t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}
loadEnv();
import { higgsfieldUpload, higgsfieldGenerate } from "./_higgsfield-cli";
import { HERO_PROMPT } from "../src/lib/hero/prompt";
const SRC_DL=path.join(os.homedir(),"Downloads","O1CN010bDjtk2NVOlAe0i9B_!!2207889479968-0-cib.jpg");
const TEMPLATE=path.join(os.tmpdir(),"scene","v25-refs","positioning-template.png");
const OUT=path.resolve(".tmp-hero-test"); fs.mkdirSync(OUT,{recursive:true});
const cleanSrc=path.join(OUT,"source.jpg"); fs.copyFileSync(SRC_DL,cleanSrc);
(async()=>{
  const t0=Date.now();
  const hasT=fs.existsSync(TEMPLATE);
  console.log("source:",cleanSrc,"("+fs.statSync(cleanSrc).size+" bytes)");
  console.log("template:",hasT?"found":"MISSING -> source-only");
  const srcId=await higgsfieldUpload(cleanSrc);
  const inputs=hasT?[srcId, await higgsfieldUpload(TEMPLATE)]:[srcId];
  console.log("uploaded",inputs.length,"input(s); generating...");
  const {imageBuffer,resultUrl}=await higgsfieldGenerate({prompt:HERO_PROMPT,inputUploadIds:inputs});
  const heroPath=path.join(OUT,"hero.png");
  fs.writeFileSync(heroPath,imageBuffer);
  console.log(`HERO saved (${Math.round((Date.now()-t0)/1000)}s): ${heroPath} (${imageBuffer.length} bytes)`);
  console.log("resultUrl:",resultUrl);
})().catch(e=>{console.error("HERO FAILED:",e instanceof Error?e.message:e);process.exit(1);});
