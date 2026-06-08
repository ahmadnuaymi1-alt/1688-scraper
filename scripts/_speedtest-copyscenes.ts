import fs from "node:fs";
const [oldId, newId] = [process.argv[2], process.argv[3]];
if (!oldId || !newId) throw new Error("usage: _speedtest-copyscenes.ts <oldPid> <newPid>");
const doc = JSON.parse(fs.readFileSync(`scene-overrides/${oldId}.json`, "utf8"));
doc.productId = newId;
fs.writeFileSync(`scene-overrides/${newId}.json`, JSON.stringify(doc, null, 2));
console.log(`copied ${doc.scenes?.length ?? 0} scenes ${oldId} → ${newId}`);
