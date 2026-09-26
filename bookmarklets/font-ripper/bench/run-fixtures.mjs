// Fixture benchmark: runs the bookmarklet on every case page, clicks "Download All" and checks the ZIP.
//   node bench/run-fixtures.mjs [--min] [--headed] [case-id-substring …]
// Per expected font: FILE (in ZIP, byte-identical) · URL (listed, not in ZIP) · NAME (family listed only) · MISS
// A file is "attributed" when its ZIP folder is the page's family name (Vec NN), not just its internal name.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { start } from "./server.mjs";
import { fontBytes } from "./cases.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH || execFileSync("sh", ["-c", "dirname $(readlink -f $(npx -y -p playwright@1.63.0 which playwright))"]).toString().trim();
const pw = require(pwPath);
const engine = (process.argv.find(a => a.startsWith("--browser=")) || "--browser=chromium").split("=")[1];

const args = process.argv.slice(2);
const useMin = args.includes("--min");
const headed = args.includes("--headed");
const filters = args.filter(a => !a.startsWith("--"));
const code = fs.readFileSync(path.join(here, "..", useMin ? "minified.js" : "full_code.js"), "utf8").replace(/^javascript:/, "");
const outDir = path.join(here, "results");
fs.mkdirSync(outDir, { recursive: true });

const sha1 = b => crypto.createHash("sha1").update(b).digest("hex");
const p2 = id => String(id).padStart(2, "0");
const hashToId = new Map();
for (let id = 1; id <= 80; id++) for (const fmt of ["woff2", "woff", "ttf"]) hashToId.set(sha1(fontBytes(id, fmt)), id);

const srv = start();
const browser = await pw[engine].launch({ headless: !headed });
const results = [];
for (const c of srv.list.filter(c => !filters.length || filters.some(f => c.id.includes(f)))) {
  srv.resetOnce();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("dialog", d => d.dismiss());
  page.on("pageerror", e => errors.push(e.message));
  let listing = [], zipFiles = [], note = "";
  try {
    await page.goto(`${srv.A}/cases/${c.id}.html`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.evaluate(code);
    if (c.second) {
      // Interact after the first run (overlay closed), then run again
      await page.click("#font-inspector-overlay #close-btn").catch(() => {});
      await page.click(c.second);
      await page.waitForTimeout(1200);
      await page.evaluate(code);
    }
    listing = await page.evaluate(() => [...document.querySelectorAll("#font-inspector-overlay .font-sample")].map(s => ({
      name: s.querySelector("summary").textContent,
      family: s.querySelector(".font-preview").style.fontFamily,
      urls: [...s.querySelectorAll("a.font-link")].map(a => a.href),
      notes: [...s.querySelectorAll(".font-style-note")].map(n => n.textContent),
    })));
    if (listing.length) {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("text=Download All")]);
      const zipPath = path.join(outDir, c.id + ".zip");
      await dl.saveAs(zipPath);
      zipFiles = JSON.parse(execFileSync("python3", ["-c", `import zipfile,hashlib,json,sys
z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([[i.filename,hashlib.sha1(z.read(i)).hexdigest()] for i in z.infolist() if not i.is_dir()]))`, zipPath]).toString());
    }
  } catch (e) { note = e.message.split("\n")[0]; }
  await ctx.close();

  const text = JSON.stringify(listing);
  const status = c.expect.map(id => {
    const inZip = zipFiles.filter(([, h]) => hashToId.get(h) === id);
    if (inZip.length) return { id, s: "FILE", attributed: c.anon || inZip.some(([f]) => f.startsWith(`Vec ${p2(id)}/`)) };
    if (listing.some(l => l.urls.some(u => u.includes(`f${p2(id)}`)))) return { id, s: "URL" };
    if (text.includes(`Vec ${p2(id)}`) || text.includes(`Int ${p2(id)}`)) return { id, s: "NAME" };
    return { id, s: "MISS" };
  });
  const extra = zipFiles.filter(([f, h]) => f !== "_not-downloaded.txt" && !c.expect.includes(hashToId.get(h))).map(([f]) => f);
  results.push({ id: c.id, desc: c.desc, hard: !!c.hard, status, extra, note, errors });
  const sym = { FILE: "✔", URL: "~", NAME: "?", MISS: "✘" };
  console.log(`${status.map(s => sym[s.s] + (s.s === "FILE" && !s.attributed ? "ᵘ" : "")).join("").padEnd(6)} ${c.id.padEnd(26)}${c.hard ? " (hard)" : ""}${extra.length ? "  extra: " + extra.join(", ") : ""}${note ? "  ERR " + note : ""}`);
}
await browser.close();
srv.close();

const all = results.flatMap(r => r.status.map(s => ({ ...s, hard: r.hard })));
const count = (arr, k) => arr.filter(s => s.s === k).length;
for (const [label, arr] of [["all", all], ["non-hard", all.filter(s => !s.hard)]]) {
  console.log(`${label}: FILE ${count(arr, "FILE")}/${arr.length} (unattributed ${arr.filter(s => s.s === "FILE" && !s.attributed).length}) · URL ${count(arr, "URL")} · NAME ${count(arr, "NAME")} · MISS ${count(arr, "MISS")}`);
}
fs.writeFileSync(path.join(outDir, "fixtures.json"), JSON.stringify(results, null, 1));
