import fs from "node:fs";
const PID = process.argv[2];
if (!PID) throw new Error("usage: _speedtest2-scenes.ts <pid>");
const SRC = "scene-overrides/cmq406kfj000jw2kcgbtfugv6.json";
const doc = JSON.parse(fs.readFileSync(SRC, "utf8"));
doc.productId = PID;
fs.writeFileSync(`scene-overrides/${PID}.json`, JSON.stringify(doc, null, 2));
console.log("scenes written for", PID);
