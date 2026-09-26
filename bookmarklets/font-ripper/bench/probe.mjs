// Debug one fixture: node bench/probe.mjs <case-id> — prints resource timing and document.fonts
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { start } from "./server.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(execFileSync("sh", ["-c", "dirname $(readlink -f $(npx -y -p playwright@1.63.0 which playwright))"]).toString().trim());
const srv = start();
const b = await chromium.launch();
const p = await b.newPage();
p.on("console", m => console.log("console:", m.text()));
p.on("requestfailed", r => console.log("failed:", r.url(), r.failure().errorText));
await p.goto(`${srv.A}/cases/${process.argv[2]}.html`);
await p.waitForTimeout(1200);
console.log(await p.evaluate(() => ({
  rt: performance.getEntriesByType("resource").map(e => e.initiatorType + " " + e.name.slice(0, 100)),
  fonts: [...document.fonts].map(f => f.family + " " + f.status),
})));
await b.close(); srv.close();
