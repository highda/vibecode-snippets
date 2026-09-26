// Live-site benchmark: ground truth from the network (every response whose first bytes are a font
// signature) and a FontFace hook; checked against the ZIP that "Download All" produces.
//   node bench/run-live.mjs [--min] [--headed] [--jobs=4] [site-substring …]
// found   = network font bytes present in the ZIP (main frame + same-origin frames)
// wrong   = hooked JS FontFace(url) whose file is listed only under other, named families
// unattr. = hooked JS FontFace(url) whose file is listed only as an unattributed file
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const SITES = [
  "https://205.tf/plaak", "https://klim.co.nz/retail-fonts/national-2/", "https://abcdinamo.com/typefaces/diatype",
  "https://pangrampangram.com/products/neue-montreal", "https://www.grillitype.com/typeface/gt-america",
  "https://lineto.com/typefaces/circular", "https://www.colophon-foundry.org/typefaces/basis-grotesque",
  "https://www.typotheque.com/fonts/fedra-sans", "https://sharptype.co/typefaces/sharp-grotesk",
  "https://ohnotype.co/fonts/obviously", "https://fonts.google.com/specimen/Inter", "https://www.fontshare.com/fonts/satoshi",
  "https://www.swisstypefaces.com/fonts/suisse/", "https://optimo.ch/typefaces/theinhardt",
  "https://www.typography.com/fonts/gotham/overview", "https://fonts.adobe.com/fonts/proxima-nova", "https://www.futurefonts.xyz",
  "https://velvetyne.fr/fonts/", "https://rsms.me/inter/", "https://productiontype.com/family/spezia",
  "https://displaay.net/typeface/", "https://www.fontfabric.com/fonts/nexa/", "https://www.dharmatype.com", "https://www.typewolf.com",
  "https://commercialtype.com",
];

// General sites (not foundries): robustness — CSP, Trusted Types, huge SPAs, many iframes
const ROBUST = [
  "https://github.com/microsoft/vscode", "https://www.youtube.com", "https://en.wikipedia.org/wiki/Typeface", "https://www.nytimes.com",
  "https://www.apple.com", "https://stripe.com", "https://www.figma.com", "https://medium.com", "https://www.bbc.com", "https://www.notion.so",
  "https://vercel.com", "https://linear.app", "https://www.airbnb.com", "https://open.spotify.com", "https://www.google.com",
  "https://www.reddit.com", "https://www.amazon.com", "https://x.com", "https://www.theguardian.com/international", "https://example.com",
];

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH || execFileSync("sh", ["-c", "dirname $(readlink -f $(npx -y -p playwright@1.63.0 which playwright))"]).toString().trim();
const { chromium } = require(pwPath);

const args = process.argv.slice(2);
const opt = k => (args.find(a => a.startsWith(`--${k}=`)) || "").split("=")[1];
const filters = args.filter(a => !a.startsWith("--"));
const code = fs.readFileSync(path.join(here, "..", args.includes("--min") ? "minified.js" : "full_code.js"), "utf8").replace(/^javascript:/, "");
const outDir = path.join(here, "results", "live");
fs.mkdirSync(outDir, { recursive: true });
const sha1 = b => crypto.createHash("sha1").update(b).digest("hex");
const MAGIC = ["wOF2", "wOFF", "OTTO", "true", "ttcf", "\x00\x01\x00\x00"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const HOOK = () => {
  const seen = (window.__ffHook = []);
  const Orig = window.FontFace;
  window.FontFace = function (family, src, desc) {
    seen.push({ family: String(family).replace(/["']/g, "").trim(), src: typeof src === "string" ? src : "[buffer]", base: location.href });
    return new Orig(family, src, desc);
  };
  window.FontFace.prototype = Orig.prototype;
};

async function runSite(browser, url) {
  const ctx = await browser.newContext({ acceptDownloads: true, userAgent: UA, viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(HOOK);
  const page = await ctx.newPage();
  page.on("dialog", d => d.dismiss());
  page.on("crash", () => console.log("  [crash]", url));
  page.on("popup", pp => console.log("  [popup]", pp.url()));
  const net = new Map(); // url -> { hash, cross }
  const pendingBodies = [];
  let running = false; // responses after this point were triggered by the bookmarklet itself
  page.on("response", r => {
    if (["document", "script", "stylesheet", "image", "media"].includes(r.request().resourceType())) return;
    pendingBodies.push(r.body().then(b => {
      if (b.length < 12 || !MAGIC.includes(b.subarray(0, 4).toString("latin1"))) return;
      const cross = r.frame() !== page.mainFrame() && new URL(r.frame().url() || url).origin !== new URL(page.url()).origin;
      const urls = [r.url()];
      for (let q = r.request().redirectedFrom(); q; q = q.redirectedFrom()) urls.push(q.url());
      if (!net.has(r.url())) net.set(r.url(), { hash: sha1(b), cross, urls, page: !running });
    }).catch(() => {}));
  });
  const res = { url, error: "" };
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(350); }
    await page.waitForTimeout(2500);
    await Promise.race([Promise.all(pendingBodies), new Promise(r => setTimeout(r, 8000))]); // streaming responses never finish
    running = true;
    const t0 = Date.now();
    await Promise.race([page.evaluate(code), new Promise((_, rej) => setTimeout(() => rej(new Error("bookmarklet timeout")), 180000))]);
    res.ms = Date.now() - t0;

    await Promise.race([Promise.all(pendingBodies), new Promise(r => setTimeout(r, 8000))]); // streaming responses never finish
    const listing = await page.evaluate(() => [...document.querySelectorAll("#font-inspector-overlay .font-sample")].map(s => ({
      name: s.querySelector("summary").textContent,
      family: s.querySelector(".font-preview").style.fontFamily.replace(/["']/g, ""),
      urls: [...s.querySelectorAll("a.font-link")].map(a => a.href),
      notes: [...s.querySelectorAll(".font-style-note")].map(n => n.textContent),
    })));
    res.stats = await page.evaluate(() => window.__fontRipperStats);
    res.phases = (res.stats.phases || []).map(([s, t], i, a) => [s, (a[i + 1] ? a[i + 1][1] : res.ms) - t]);
    const hooks = await page.evaluate(() => window.__ffHook || []);
    const notes = await page.evaluate(() => [...document.querySelectorAll("#font-inspector-overlay .frames-note")].map(n => n.firstChild.textContent));
    let zip = [];
    if (listing.length) {
      const zipPath = path.join(outDir, new URL(url).hostname + ".zip");
      try {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: +(opt("dl") || 300) * 1000 }), page.click("#font-inspector-overlay >> text=Download All")]);
        await dl.saveAs(zipPath);
        res.dlStatus = await page.evaluate(() => document.querySelector("#font-inspector-overlay .dl-status").textContent);
      } catch (e) { res.dlStatus = "DOWNLOAD TIMEOUT"; }
      if (fs.existsSync(zipPath) && res.dlStatus !== "DOWNLOAD TIMEOUT") zip = JSON.parse(execFileSync("python3", ["-c", `import zipfile,hashlib,json,sys
z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([[i.filename,hashlib.sha1(z.read(i)).hexdigest()] for i in z.infolist() if not i.is_dir()]))`, zipPath]).toString());
    }
    const zipHashes = new Set(zip.map(([, h]) => h));
    // Truth = fonts the page itself loaded (before the run); "listed" = URL/alias in the UI or bytes in the ZIP
    const main = [...net.values()].filter(n => !n.cross && n.page);
    const listedUrls = new Set(listing.flatMap(l => l.urls));
    const isListed = n => zipHashes.has(n.hash) || n.urls.some(u => listedUrls.has(u));
    const missing = main.filter(n => !isListed(n));
    res.zipped = main.filter(n => zipHashes.has(n.hash)).length;
    res.extraNet = [...net.values()].filter(n => !n.page).length;
    // Attribution of URL-based JS FontFaces
    let wrong = 0, unattr = 0, right = 0;
    const wrongList = [], unattrList = [];
    for (const h of hooks) {
      const m = h.src.match(/url\(\s*["']?([^"')]+)/);
      if (!m) continue;
      let u; try { u = new URL(m[1], h.base).href; } catch { continue; }
      if (!net.has(u)) continue;
      const holders = listing.filter(l => l.urls.includes(u) || net.get(u).urls.some(a => l.urls.includes(a)));
      if (holders.some(l => l.family === h.family)) right++;
      else if (holders.length && holders.every(l => l.family.startsWith("font-ripper-"))) { unattr++; unattrList.push(`${h.family} ← ${u} (${holders.map(l => l.notes[0]).join(" / ").slice(0, 200)})`); }
      else if (holders.length) { wrong++; wrongList.push(`${h.family} ← ${u}`); }
    }
    Object.assign(res, {
      net: main.length, crossNet: [...net.values()].filter(n => n.cross && n.page).length, found: main.length - missing.length,
      missing: missing.map(n => n.urls[0]), families: listing.length, zipFiles: zip.length,
      orphans: listing.filter(l => l.notes.some(n => n.includes("not recoverable"))).map(l => l.name),
      jsRight: right, jsUnattr: unattr, jsWrong: wrong, wrongList, notes, unattrList,
      orphanDetail: listing.filter(l => l.notes.some(n => n.includes("not recoverable"))).map(l => ({ name: l.name, note: l.notes[0], hooks: hooks.filter(h => h.family === l.family).map(h => h.src.slice(0, 140)) })),
    });
  } catch (e) { res.error = e.message.split("\n")[0]; }
  await ctx.close().catch(() => {});
  return res;
}

function report(r) {
  const host = new URL(r.url).hostname.replace(/^www\./, "");
  if (r.error) return `ERR  ${host.padEnd(24)} ${r.error}`;
  const lines = [`${String(r.found).padStart(4)}/${String(r.net).padEnd(4)} zip ${String(r.zipped).padStart(4)} +${String(r.extraNet).padEnd(4)} ${host.padEnd(24)} fam ${String(r.families).padStart(4)} js ✔${r.jsRight} ᵘ${r.jsUnattr} ✘${r.jsWrong} ${(r.ms / 1000).toFixed(1)}s` +
    (r.orphans.length ? ` orphans:${r.orphans.length}` : "") + (r.crossNet ? ` xframe:${r.crossNet}` : "")];
  lines.push(`      ${r.phases.filter(([, t]) => t > 500).map(([s, t]) => `${s.slice(0, 30)} ${(t / 1000).toFixed(1)}s`).join(" | ")} · jsFaces ${r.stats.jsFaces} · fetches ${r.stats.fetches} refs ${r.stats.sourceRefs}/${r.stats.sourceUrls}`);
  if (r.dlStatus && !/famil/.test(r.dlStatus)) lines.push("      download: " + r.dlStatus);
  if (r.missing.length) lines.push("      missing: " + r.missing.slice(0, 5).join(" "));
  if (r.wrongList.length) lines.push("      wrong: " + r.wrongList.slice(0, 5).join(" | "));
  if (args.includes("--verbose")) {
    lines.push("      kinds: " + JSON.stringify(r.stats.kinds || {}) + " marks: " + JSON.stringify(r.stats.marks) + " textBytes: " + r.stats.textBytes);
    for (const c of (r.stats.cssRefTimes || []).sort((a, b) => b[2] - a[2]).slice(0, 8)) lines.push("      css: " + c.join(" "));
    for (const u of r.unattrList) lines.push("      unattributed: " + u);
    for (const o of r.orphanDetail) lines.push(`      orphan: ${o.name} — hooks: ${o.hooks.join(" ; ") || "none"}`);
  }
  return lines.join("\n");
}

let browser = await chromium.launch({ headless: !args.includes("--headed") });
const sites = (args.includes("--robust") ? ROBUST : SITES).filter(s => !filters.length || filters.some(f => s.includes(f)));
const jobs = +(opt("jobs") || 4);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < sites.length) {
    const url = sites[next++];
    // A heavy page can take the whole browser down; start a fresh one for the next site
    if (!browser.isConnected()) browser = await chromium.launch({ headless: !args.includes("--headed") });
    const r = await runSite(browser, url);
    results.push(r);
    const host = new URL(url).hostname.replace(/^www\./, "");
    console.log(report(r));
  }
}));
await browser.close();
const ok = results.filter(r => !r.error);
const sum = k => ok.reduce((a, r) => a + r[k], 0);
console.log(`TOTAL listed ${sum("found")}/${sum("net")} zipped ${sum("zipped")} +${sum("extraNet")} via bookmarklet on ${ok.length} sites · js ✔${sum("jsRight")} ᵘ${sum("jsUnattr")} ✘${sum("jsWrong")} · slowest ${Math.max(...ok.map(r => r.ms)) / 1000}s`);
fs.writeFileSync(path.join(outDir, "live.json"), JSON.stringify(results, null, 1));
