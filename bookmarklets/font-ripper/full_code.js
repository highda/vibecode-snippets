javascript:(async()=>{
  // Run again while the overlay is open: close the old one first (restores page scrolling)
  const previous = document.getElementById("font-inspector-overlay");
  if (previous) { const close = previous.querySelector("#close-btn"); close ? close.click() : previous.remove(); }

  /* ── Loading splash (DOM APIs only: innerHTML breaks on Trusted Types pages) ── */
  const overlay = document.createElement("div");
  overlay.id = "font-inspector-overlay";
  const splashStyle = document.createElement("style");
  splashStyle.textContent = `
    #font-inspector-overlay {
      position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;
      justify-content:center;background:#fff;color:#000;font-family:sans-serif;
      font-size:18px;
    }
    #font-inspector-overlay .spinner {
      width:20px;height:20px;border:2px solid #ccc;border-top-color:#000;
      border-radius:50%;animation:fi-spin .6s linear infinite;margin-right:12px;
    }
    @keyframes fi-spin{to{transform:rotate(360deg)}}
    #font-inspector-overlay .splash-col{display:flex;flex-direction:column;gap:8px;min-width:280px}
    #font-inspector-overlay .splash-bar{height:4px;background:#e5e5e5;border-radius:2px;overflow:hidden}
    #font-inspector-overlay .splash-fill{height:100%;width:0;background:#000;transition:width .2s}
    #font-inspector-overlay .splash-pct{font-size:14px;font-variant-numeric:tabular-nums;opacity:.7}
  `;
  document.head.appendChild(splashStyle);
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  const splashText = document.createElement("span");
  splashText.textContent = "Loading fonts…";
  const splashCol = Object.assign(document.createElement("div"), { className: "splash-col" });
  const splashBar = Object.assign(document.createElement("div"), { className: "splash-bar" });
  const splashFill = Object.assign(document.createElement("div"), { className: "splash-fill" });
  const splashPct = Object.assign(document.createElement("span"), { className: "splash-pct", textContent: "0 %" });
  splashBar.appendChild(splashFill);
  splashCol.append(splashText, splashBar, splashPct);
  overlay.append(spinner, splashCol);
  document.body.appendChild(overlay);

  // Percent progress. Each scan phase owns a slice of 0–100; long phases advance per item within it.
  // Never moves backwards; a second step (recovery) restarts it with its own label.
  let progressShown = 0, progressStep = "", progressRange = [0, 100];
  const setProgress = pct => {
    const [lo, hi] = progressRange;
    const v = Math.max(progressShown, Math.min(100, Math.round(lo + (hi - lo) * Math.min(100, pct) / 100)));
    progressShown = v;
    splashFill.style.width = v + "%";
    splashPct.textContent = progressStep + v + " %";
  };
  const slice = (from, to) => { setProgress(from); return (done, total) => setProgress(from + (to - from) * (total ? Math.min(1, done / total) : 1)); };
  // Phase timings + request counts, readable as window.__fontRipperStats (used by the benchmark)
  const stats = window.__fontRipperStats = { phases: [], fetches: 0, t0: performance.now() };
  const setSplash = msg => { splashText.textContent = msg; stats.phases.push([msg, Math.round(performance.now() - stats.t0)]); };

  const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i;
  const NON_FONT_EXT = /\.(css|m?js|json|map|html?|php|xml|txt|png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|mov|mp3|wav|ogg|wasm|pdf|zip)(\?|#|$)/i;
  const MAGIC = ["wOF2", "wOFF", "OTTO", "true", "ttcf", "\x00\x01\x00\x00"];
  const cleanFamily = s => s.replace(/["']/g, "").trim();
  const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Every request times out: resource timing also lists long-poll / streaming endpoints that never finish
  const get = (url, ms = 15000) => (stats.fetches++, fetch)(url, { cache: "force-cache", signal: AbortSignal.timeout(ms) });
  const fileName = url => { try { return decodeURIComponent(url.split("/").pop().split(/[?#]/)[0]) || url; } catch { return url; } };

  /* ── Capture: from the first run on, keep what the page builds fonts from ──
     FontFace(buffer) and blob: URLs exist only in memory (decrypted type-tester fonts); wrapping the two
     constructors lets a later run hand those bytes out. Stays installed until the tab reloads. */
  function installCapture(win) {
    if (win.__fontRipperCapture) return false;
    const cap = win.__fontRipperCapture = { faces: [], blobs: [] };
    try {
      const Native = win.FontFace;
      const Wrapped = function FontFace(family, source, descriptors) {
        const face = new Native(family, source, descriptors);
        try {
          if (!String(family).startsWith("font-ripper-")) {
            if (typeof source === "string") cap.faces.push({ family, src: source });
            else if (source && source.byteLength < 30e6) cap.faces.push({ family, bytes: new Uint8Array(ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : source.slice(0)) });
          }
        } catch {}
        return face;
      };
      Wrapped.prototype = Native.prototype;
      Object.setPrototypeOf(Wrapped, Native);
      win.FontFace = Wrapped;
      const createObjectURL = win.URL.createObjectURL;
      win.URL.createObjectURL = function (obj) {
        const url = createObjectURL.call(this, obj);
        try { if (obj instanceof win.Blob && obj.size > 12 && obj.size < 30e6) cap.blobs.push({ url, blob: obj }); } catch {}
        return url;
      };
    } catch {}
    return true;
  }
  const captureIsNew = installCapture(window);

  // Recovery frame only (never the user's page): run classic workers through a boot script that hooks
  // FontFace inside the worker and reports over a BroadcastChannel. The worker then runs from a blob:
  // URL, so its relative fetch/importScripts/XHR URLs are resolved against the original script URL.
  function workerBoot(base) {
    const channel = new BroadcastChannel("font-ripper-capture");
    const abs = u => (typeof u === "string" ? new URL(u, base).href : u);
    const nativeFetch = self.fetch;
    self.fetch = (u, o) => nativeFetch.call(self, abs(u), o);
    const nativeImport = self.importScripts; // absent in module workers
    if (nativeImport) self.importScripts = (...urls) => nativeImport.apply(self, urls.map(abs));
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) { return open.call(this, m, abs(u), ...rest); };
    const Native = self.FontFace;
    self.FontFace = function FontFace(family, source, descriptors) {
      const face = new Native(family, source, descriptors);
      try {
        channel.postMessage(typeof source === "string" ? { family: String(family), src: source, base }
          : { family: String(family), bytes: new Uint8Array(ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : source.slice(0)) });
      } catch {}
      return face;
    };
    self.FontFace.prototype = Native.prototype;
  }
  function hookWorkers(win) {
    const cap = win.__fontRipperCapture;
    const channel = new win.BroadcastChannel("font-ripper-capture");
    channel.onmessage = e => { if (e.data && e.data.family) cap.faces.push(e.data); };
    cap.close = () => channel.close();
    const NativeWorker = win.Worker;
    win.Worker = function Worker(url, options) {
      const abs = new win.URL(url, win.location.href).href;
      const boot = options && options.type === "module"
        ? `(${workerBoot})(${JSON.stringify(abs)});await import(${JSON.stringify(abs)});`
        : `(${workerBoot})(${JSON.stringify(abs)});importScripts(${JSON.stringify(abs)});`;
      try { return new NativeWorker(win.URL.createObjectURL(new win.Blob([boot], { type: "text/javascript" })), options); } catch { return new NativeWorker(url, options); }
    };
    win.Worker.prototype = NativeWorker.prototype;
  }

  // Fonts a page builds from memory while loading were created before any bookmarklet could hook them.
  // Re-run the page in a hidden, sandboxed frame: hook a blank frame's window, then document.write the
  // page's HTML into it — document.open keeps the Window (and the hook) and takes this page's URL, so
  // routers and relative URLs behave. Uses the page's CSP nonce when it has one; Trusted Types block it.
  async function captureInFrame(timeoutMs = 15000) {
    let html;
    try { const r = await get(location.href, 8000); html = await r.text(); } catch { html = document.documentElement.outerHTML; }
    const nonce = (document.querySelector("script[nonce]") || {}).nonce || "";
    const n = nonce ? ` nonce="${nonce}"` : "";
    if (nonce) html = html.replace(/\snonce=("[^"]*"|'[^']*'|[^\s>]*)/gi, "").replace(/<script\b/gi, `<script${n}`);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:900px;visibility:hidden;border:0";
    document.body.appendChild(frame);
    try {
      installCapture(frame.contentWindow);
      try { hookWorkers(frame.contentWindow); } catch {}
      try { frame.contentWindow.performance.setResourceTimingBufferSize(100000); } catch {}
      const d = frame.contentDocument;
      d.open();
      d.write(html);
      d.close();
    } catch { frame.remove(); return 0; }
    // Wait until the page has loaded and nothing new was captured for a while
    const t0 = Date.now();
    let last = -1, stableSince = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));
      let cap = null, ready = false;
      try { cap = frame.contentWindow.__fontRipperCapture; ready = frame.contentDocument.readyState === "complete"; } catch {}
      const n = cap ? cap.faces.length + cap.blobs.length : 0;
      if (n !== last) { last = n; stableSince = Date.now(); }
      else if (ready && Date.now() - stableSince > (n ? 2500 : 4000)) break;
    }
    let cap = null;
    try { cap = frame.contentWindow.__fontRipperCapture; } catch {}
    // The frame's resource timing starts empty: fonts the page loaded before its own buffer filled up
    // (or before it cleared it) show up here again
    let rt = [];
    try { rt = frame.contentWindow.performance.getEntriesByType("resource").map(e => ({ name: e.name, initiatorType: e.initiatorType })); } catch {}
    (window.__fontRipperCapture.rt ||= []).push(...rt);
    if (cap) {
      window.__fontRipperCapture.faces.push(...cap.faces);
      // Read blobs now: the frame's blob: URLs die with it
      for (const { url, blob } of cap.blobs) { try { window.__fontRipperCapture.blobs.push({ url, blob: new Blob([await blob.arrayBuffer()]) }); } catch {} }
    }
    try { cap.close(); } catch {}
    frame.remove();
    return (cap ? cap.faces.length + cap.blobs.length : 0) + rt.length;
  }

  /* ── Run async tasks with limited concurrency ── */
  // budgetMs: stop starting new items after that long (speculative work on huge pages)
  // tick(done, total): progress callback after each item
  async function pool(items, limit, fn, budgetMs = Infinity, tick) {
    let i = 0, done = 0;
    const end = performance.now() + budgetMs;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length && performance.now() < end) { const item = items[i++]; await fn(item); if (tick) tick(++done, items.length); }
    }));
    if (tick) tick(items.length, items.length);
  }

  /* ── Binary font parsing: sniff format, read name + OS/2 tables ── */
  const tagAt = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  let brotliPromise;
  function loadBrotli() {
    // WOFF2 is brotli-compressed; browsers expose no brotli decoder to JS, so load a small one on demand
    brotliPromise ||= import("https://cdn.jsdelivr.net/npm/brotli@1.3.3/decompress.js/+esm").then(m => m.default).catch(() => null);
    return brotliPromise;
  }
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const WOFF2_TAGS = "cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".match(/.{4} ?/g).map(t => t.slice(0, 4));

  // Returns { tagName: Uint8Array } for the requested tables
  async function getTables(u8, wanted) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const magic = tagAt(u8, 0);
    const out = {};
    if (magic === "wOFF") {
      const n = dv.getUint16(12);
      for (let i = 0; i < n; i++) {
        const o = 44 + i * 20, tag = tagAt(u8, o);
        if (!wanted.includes(tag)) continue;
        const off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), orig = dv.getUint32(o + 12);
        const data = u8.subarray(off, off + comp);
        out[tag] = comp < orig ? await inflate(data) : data;
      }
    } else if (magic === "wOF2") {
      const n = dv.getUint16(12);
      let p = 48;
      const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = u8[p++]; v = v * 128 + (b & 127); if (!(b & 128)) break; } return v; };
      const dir = [];
      for (let i = 0; i < n; i++) {
        const flags = u8[p++];
        let tag;
        if ((flags & 63) === 63) { tag = tagAt(u8, p); p += 4; } else tag = WOFF2_TAGS[flags & 63];
        const orig = base128();
        const xform = flags >> 6;
        const transformed = (tag === "glyf" || tag === "loca") ? xform === 0 : xform !== 0;
        dir.push({ tag, len: transformed ? base128() : orig });
      }
      if (tagAt(u8, 4) === "ttcf") return out; // collections: skip
      const brotli = await loadBrotli();
      if (!brotli) return out;
      const data = brotli(u8.subarray(p, p + dv.getUint32(20)));
      let off = 0;
      for (const { tag, len } of dir) {
        if (wanted.includes(tag)) out[tag] = data.subarray(off, off + len);
        off += len;
      }
    } else if (["OTTO", "true", "\x00\x01\x00\x00"].includes(magic)) {
      const n = dv.getUint16(4);
      for (let i = 0; i < n; i++) {
        const o = 12 + i * 16, tag = tagAt(u8, o);
        if (wanted.includes(tag)) out[tag] = u8.subarray(dv.getUint32(o + 8), dv.getUint32(o + 8) + dv.getUint32(o + 12));
      }
    }
    return out;
  }

  // { family, subfamily, full, ps, weight, italic } or null
  async function readFontInfo(u8) {
    let t;
    try { t = await getTables(u8, ["name", "OS/2"]); } catch { return null; }
    if (!t.name) return null;
    const nd = new DataView(t.name.buffer, t.name.byteOffset, t.name.byteLength);
    const count = nd.getUint16(2), strOff = nd.getUint16(4);
    const names = {};
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 12;
      const plat = nd.getUint16(o), lang = nd.getUint16(o + 4), id = nd.getUint16(o + 6);
      const len = nd.getUint16(o + 8), off = strOff + nd.getUint16(o + 10);
      const bytes = t.name.subarray(off, off + len);
      let s;
      if (plat === 3 || plat === 0) { s = ""; for (let j = 0; j + 1 < bytes.length; j += 2) s += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]); }
      else if (plat === 1) s = String.fromCharCode(...bytes);
      else continue;
      // Prefer Windows English, then anything
      const score = (plat === 3 && lang === 0x409) ? 2 : 1;
      if (!names[id] || names[id].score < score) names[id] = { s, score };
    }
    const n = id => names[id] && names[id].s.trim();
    const info = { family: n(16) || n(1), subfamily: n(17) || n(2), full: n(4), ps: n(6), weight: 400, italic: false };
    if (t["OS/2"] && t["OS/2"].length > 63) {
      const od = new DataView(t["OS/2"].buffer, t["OS/2"].byteOffset);
      info.weight = od.getUint16(4) || 400;
      info.italic = !!(od.getUint16(62) & 1);
    }
    return info.family ? info : null;
  }

  /* ── Glyph signatures: advance widths + ink bounds per character ── */
  // One canvas per document: a canvas only sees the fonts of the document that created it
  const sigCtxs = new Map();
  const ctxFor = doc => { if (!sigCtxs.has(doc)) sigCtxs.set(doc, doc.createElement("canvas").getContext("2d")); return sigCtxs.get(doc); };
  const PROBE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&@?!%";
  const parseRange = unicodeRange => (unicodeRange || "U+0-10FFFF").split(",").map(part => {
    const [a, b] = part.trim().replace(/^U\+/i, "").split("-");
    return a.includes("?") ? [parseInt(a.replace(/\?/g, "0"), 16), parseInt(a.replace(/\?/g, "F"), 16)] : [parseInt(a, 16), parseInt(b || a, 16)];
  });
  const inRanges = (c, ranges) => ranges.some(([a, b]) => c >= a && c <= b);
  // Probe characters only this face renders: inside its unicode-range (subsets like Google Fonts' cyrillic
  // never cover ASCII) and outside sibling faces' ranges (overlapping code points go to another subset)
  function probeFor(face, siblings) {
    const own = parseRange(face.unicodeRange);
    const others = siblings.map(f => parseRange(f.unicodeRange));
    const usable = c => c > 0x20 && (c < 0x7f || c > 0xa0) && !others.some(r => inRanges(c, r));
    const chars = [...PROBE].filter(ch => inRanges(ch.codePointAt(0), own) && usable(ch.codePointAt(0)));
    for (const [a, b] of own) {
      for (let c = a; c <= b && c < 0x30000 && chars.length < 70; c++) {
        if (usable(c) && !chars.includes(String.fromCodePoint(c))) chars.push(String.fromCodePoint(c));
      }
    }
    return chars.join("") || PROBE;
  }
  function signature(fontSpec, probe = PROBE, doc = document) {
    const sigCtx = ctxFor(doc);
    sigCtx.font = fontSpec;
    return [...probe].map(ch => {
      const m = sigCtx.measureText(ch);
      return [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].map(v => v.toFixed(1)).join(":");
    });
  }
  const faceSpec = (face, family) => {
    const weight = String(face.weight).split(" ")[0];
    const stretch = /^\d/.test(face.stretch) ? "normal" : String(face.stretch).split(" ")[0];
    return `${face.style.split(" ")[0]} ${weight} ${stretch} 100px "${family}", monospace`;
  };

  // querySelectorAll that also descends into open shadow roots (web components hide iframes, <style>, …)
  function deepAll(root, sel, out = []) {
    out.push(...root.querySelectorAll(sel));
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(el.shadowRoot, sel, out);
    return out;
  }

  /* ── Documents: top page + same-origin iframes; cross-origin frames are reported ── */
  function collectDocs() {
    const docs = [], foreignFrames = [], lazyFrames = [], dataFrames = [];
    (function walk(doc) {
      docs.push(doc);
      for (const f of deepAll(doc, "iframe, frame, object, embed")) {
        let d = null;
        try { d = f.contentDocument || (f.getSVGDocument && f.getSVGDocument()); } catch {}
        const src = f.src || f.data;
        // A lazy frame that hasn't loaded yet still shows its initial about:blank document
        if (/^data:/i.test(src)) dataFrames.push(src); // opaque origin: unreadable as a document, but decodable
        else if (d && d.documentElement && d.location.href === "about:blank" && /^https?:/.test(src)) lazyFrames.push(src);
        else if (d && d.documentElement) { if (!docs.includes(d)) walk(d); }
        else if (/^https?:/.test(f.src || f.data)) foreignFrames.push(f.src || f.data);
      }
    })(document);
    return { docs, foreignFrames: [...new Set(foreignFrames)], lazyFrames, dataFrames };
  }

  /* ── Collect all stylesheets (document, shadow roots, adopted) ── */
  function getAllSheets(docs) {
    const sheets = [];
    const addRoot = (root, base) => {
      for (const s of root.styleSheets) sheets.push({ sheet: s, base });
      for (const s of (root.adoptedStyleSheets || [])) sheets.push({ sheet: s, base });
    };
    for (const doc of docs) {
      addRoot(doc, doc.baseURI);
      const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) addRoot(node.shadowRoot, doc.baseURI);
      }
    }
    return sheets;
  }

  /* ── Parse @font-face / @import out of raw CSS text ── */
  const cssUrls = (src, base) => {
    const urls = [];
    for (const [, a, b, c] of src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g)) {
      const raw = (a ?? b ?? c).trim();
      // CSS inside JS source: skip template/concatenation fragments like `+n[r].path+` or ${dir}
      if (/[`{}]|\+\s*[\w$]+[[.]/.test(raw)) continue;
      try { urls.push(new URL(raw, base).href); } catch {}
    }
    return urls;
  };
  function parseCssText(text, base) {
    const faces = [], imports = [], localOnly = [];
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, block] of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const fam = (block.match(/font-family\s*:\s*(["']?)([^;"'}]+)\1/i) || [])[2];
      if (!fam) continue;
      // src may contain ";" inside url() (data:font/woff2;base64,…)
      const src = (block.match(/(?:^|[;{\s])src\s*:\s*((?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;}])+)/i) || [])[1] || "";
      const urls = cssUrls(src, base);
      if (urls.length) faces.push({ family: fam.trim(), urls, style: block.trim() });
      else if (/local\(/i.test(src)) localOnly.push(fam.trim());
    }
    for (const [, a, b] of text.matchAll(/@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])/gi)) {
      try { imports.push(new URL(a || b, base).href); } catch {}
    }
    return { faces, imports, localOnly };
  }

  // Results kept across runs in this bookmarklet session: the post-recovery rescan only does new work
  const textCache = new Map(); // url -> Promise<string>
  const fontCache = new Map(); // url -> Promise<{ bytes, json }>
  const infoCache = new WeakMap(); // bytes -> { info, hash }

  /* ── Extract fonts: every discovery source, then verify + attribute ── */
  const knownBytes = new Map(); // url -> bytes already in hand (one-time URLs, storage, base64), reused by the ZIP
  async function extractFonts() {
    // Default buffer holds 250 entries; if it's already full, fonts loaded after that left no trace
    const rtWasFull = performance.getEntriesByType("resource").length >= 250;
    // Record everything we trigger from here on, even on resource-heavy pages
    try { performance.setResourceTimingBufferSize(100000); } catch {}
    const { docs, foreignFrames, lazyFrames, dataFrames } = collectDocs();
    const found = new Map();
    const add = (family, urls, style, source, label) => {
      const key = family + "|" + urls.slice().sort().join(",") + "|" + style;
      if (!found.has(key)) found.set(key, { family, label, entry: { urls, style, source } });
    };
    const rtEntries = docs.flatMap(doc => doc.defaultView.performance.getEntriesByType("resource").map(e => ({ e, doc })));
    const fetchText = (url, ms) => {
      if (!textCache.has(url)) textCache.set(url, get(url, ms).then(r => { if (!r.ok) throw 0; return r.text(); }));
      return textCache.get(url);
    };

    // Faces are told apart per face, not per family: a page may add a JS FontFace under a family name
    // its CSS also uses. CSSOM and FontFace serialize descriptors the same way, so keys line up.
    const faceKey = (family, weight, style, stretch, range) => [family, weight || "normal", style || "normal", stretch || "normal", range || "U+0-10FFFF"].map(s => String(s).toLowerCase().replace(/\s+/g, "")).join("|");
    const keyOf = face => faceKey(cleanFamily(face.family), face.weight, face.style, face.stretch, face.unicodeRange);
    const cssFaceKeys = new Set(); // CSSOM faces with a real file
    const localOnly = new Set(); // CSSOM faces with only local() sources (metric-override fallbacks)
    const localFamilies = new Set(); // same, from regex-parsed CSS
    const cssomFamilies = new Set();
    const looseFamilies = new Set(); // families from regex-parsed CSS (descriptors not normalized)
    const addParsed = f => { add(f.family, f.urls, f.style, "CSS @font-face"); if (!cssomFamilies.has(f.family) && f.urls.some(u => !u.startsWith("blob:"))) looseFamilies.add(f.family); };

    // Pass 1: readable cssRules, recursing into @import and @media/@supports/@layer/… blocks
    const unreadable = new Set();
    const seenSheets = new Set();
    const walkedHrefs = new Set();
    const walkSheet = (sheet, base) => {
      if (seenSheets.has(sheet)) return;
      seenSheets.add(sheet);
      const sheetBase = sheet.href || base;
      let rules;
      try { rules = sheet.cssRules; } catch { if (sheet.href) unreadable.add(sheet.href); return; }
      if (sheet.href) walkedHrefs.add(sheet.href);
      if (rules) walkRules(rules, sheetBase);
    };
    const walkRules = (rules, base) => {
      for (const rule of rules) {
        if (rule.type === 5) { // CSSRule.FONT_FACE_RULE (instanceof fails across iframes)
          const style = rule.style;
          const family = cleanFamily(style.getPropertyValue("font-family"));
          const urls = cssUrls(style.getPropertyValue("src"), base);
          const key = faceKey(family, ...["font-weight", "font-style", "font-stretch", "unicode-range"].map(p => style.getPropertyValue(p)));
          if (family) cssomFamilies.add(family);
          if (family && urls.length) add(family, urls, style.cssText, "CSS @font-face");
          if (urls.some(u => !u.startsWith("blob:"))) cssFaceKeys.add(key);
          else if (!urls.length) localOnly.add(key);
        } else if (rule.type === 3 && rule.styleSheet) {
          walkSheet(rule.styleSheet, base);
        }
        if (rule.cssRules) walkRules(rule.cssRules, base);
      }
    };
    for (const { sheet, base } of getAllSheets(docs)) walkSheet(sheet, base);

    // Pass 2: regex scan inline <style> tags (catches rules the CSSOM dropped); a bare .css file opened in a tab is parsed whole
    for (const doc of docs) {
      const texts = deepAll(doc, "style").map(s => s.textContent);
      if (/css/.test(doc.contentType) && doc.body) texts.push(doc.body.textContent);
      for (const text of texts) {
        const { faces, imports, localOnly: local } = parseCssText(text, doc.baseURI);
        local.forEach(f => localFamilies.add(f));
        faces.forEach(addParsed);
        imports.forEach(u => unreadable.add(u));
      }
    }

    // Pass 3: fetch CORS-blocked sheets and follow their @imports; also sheets that were loaded but are gone
    // from the CSSOM (removed <link>, closed shadow roots)
    setProgress(5);
    setSplash("Fetching cross-origin stylesheets…");
    for (const { e } of rtEntries) if (/\.css(\?|#|$)/i.test(e.name) && !walkedHrefs.has(e.name)) unreadable.add(e.name);
    const fetchedSheets = new Set();
    const blockedSheets = new Set();
    let queue = [...unreadable];
    for (let depth = 0; depth < 4 && queue.length; depth++) {
      const next = [];
      await pool(queue.filter(u => !fetchedSheets.has(u) && !walkedHrefs.has(u)), 6, async href => {
        fetchedSheets.add(href);
        try {
          const { faces, imports, localOnly: local } = parseCssText(await fetchText(href), href);
          local.forEach(f => localFamilies.add(f));
          faces.forEach(addParsed);
          next.push(...imports);
        } catch { if (/^https?:/.test(href)) blockedSheets.add(href); }
      });
      queue = next;
    }

    const claimed = new Set();
    for (const { entry } of found.values()) entry.urls.forEach(u => claimed.add(u));
    // A blob: source may already be revoked, so such faces still need their file found elsewhere
    const cssBacked = face => cssFaceKeys.has(keyOf(face)) || looseFamilies.has(cleanFamily(face.family));

    // Pass 4: fonts registered from JS (new FontFace + document.fonts.add) never appear in CSS.
    // Load any that are still unloaded so their files show up in resource timing.
    const jsFaces = [];
    const allFaces = [];
    for (const doc of docs) {
      for (const face of doc.fonts) {
        const family = cleanFamily(face.family);
        if (family.startsWith("font-ripper-")) continue;
        if (localOnly.has(keyOf(face))) continue;
        allFaces.push({ face, family });
        if (!cssBacked(face)) jsFaces.push({ face, family, doc });
      }
    }
    stats.jsFaces = jsFaces.length;
    const pending = jsFaces.filter(({ face }) => face.status === "unloaded");
    if (pending.length) {
      setProgress(10);
      setSplash(`Loading ${pending.length} unused JS fonts…`);
      await Promise.race([
        Promise.allSettled(pending.map(({ face }) => face.load())),
        new Promise(r => setTimeout(r, 8000)),
      ]);
    }

    // Pass 5: candidate files from resource timing (any extension — sniffed below)
    const candidates = new Map();
    for (const doc of docs) {
      const recovered = doc === document ? (window.__fontRipperCapture.rt || []) : [];
      for (const e of [...doc.defaultView.performance.getEntriesByType("resource"), ...recovered]) {
        const u = e.name;
        if (claimed.has(u) || !/^https?:/.test(u) || NON_FONT_EXT.test(u)) continue;
        if (["img", "image", "script", "iframe", "navigation", "video", "audio", "track"].includes(e.initiatorType)) continue;
        // Chrome reports the MIME type: skip fetch/XHR responses that clearly aren't fonts (JSON stays —
        // scanned for paths). Not for font loads: Google's /l/font API serves fonts as text/html.
        if (/[?&]_rsc=/.test(u)) continue; // Next.js route prefetches
        if (e.contentType && (e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest") && /^(text\/(html|css|javascript|x-component)|image\/|video\/|audio\/|application\/(javascript|x-javascript|ecmascript|wasm|pdf|x-protobuf|grpc))/i.test(e.contentType)) continue;
        if (e.decodedBodySize && e.decodedBodySize < 200) continue;
        if (!candidates.has(u)) candidates.set(u, { source: "loaded", knownFont: FONT_EXT.test(u) });
      }
    }

    // Pass 6: page source, scripts, workers, JSON and web storage as text. Font data hides there as
    // @font-face CSS (CSS-in-JS, <template>, <noscript>), new FontFace("x", "url(…)") calls, plain font paths
    // (type-tester style lists) and base64 blobs.
    setProgress(14);
    setSplash("Scanning page source and scripts…");
    const mark = k => { (stats.marks ||= []).push([k, Math.round(performance.now() - stats.t0)]); };
    const texts = []; // { text, base }
    for (const doc of docs) texts.push({ text: doc.documentElement.outerHTML, base: doc.baseURI });
    // The original HTML (closed declarative shadow roots, markup scripts removed) — skipped for huge pages,
    // which are usually served no-store and would be downloaded again in full
    const nav = performance.getEntriesByType("navigation")[0];
    try { if (/^https?:/.test(location.href) && !(nav && nav.decodedBodySize > 2e6)) texts.push({ text: await fetchText(location.href, 5000), base: document.baseURI }); } catch {}
    mark("raw html");
    for (const store of ["localStorage", "sessionStorage"]) {
      try { const st = window[store]; for (let i = 0; i < st.length; i++) texts.push({ text: st.getItem(st.key(i)) || "", base: document.baseURI }); } catch {}
    }
    mark("storage");
    // Lazy frames not loaded yet, and cross-origin frames whose server allows CORS: read their HTML
    await pool([...lazyFrames, ...foreignFrames].slice(0, 30), 6, async url => {
      try { texts.push({ text: await fetchText(url), base: url }); } catch {}
    });
    for (const url of dataFrames.slice(0, 20)) { try { texts.push({ text: await (await fetch(url)).text(), base: document.baseURI }); } catch {} }
    mark("frames " + (lazyFrames.length + foreignFrames.length));
    const scriptUrls = new Set();
    for (const doc of docs) for (const s of deepAll(doc, "script[src]")) scriptUrls.add(s.src);
    // Service worker scripts: precache manifests (Workbox) list every asset of the site
    try { for (const reg of await navigator.serviceWorker.getRegistrations()) for (const w of [reg.active, reg.waiting, reg.installing]) if (w) scriptUrls.add(w.scriptURL); } catch {}
    // SVG images can embed fonts (base64 @font-face from design-tool exports)
    for (const { e } of rtEntries) if (/\.svg(\?|#|$)/i.test(e.name)) scriptUrls.add(e.name);
    for (const doc of docs) for (const img of deepAll(doc, "img[src], image, use")) { const u = img.src || (img.href && img.href.baseVal); if (u && /\.svg(\?|#|$)/i.test(u)) try { scriptUrls.add(new URL(u, doc.baseURI).href); } catch {} }
    for (const { e } of rtEntries) {
      if (/\.(m?js|json)(\?|#|$)/i.test(e.name) || (e.initiatorType === "script" && !NON_FONT_EXT.test(e.name))) scriptUrls.add(e.name);
    }
    mark("script urls");
    setProgress(18);
    setSplash(`Reading ${Math.min(scriptUrls.size, 150)} scripts…`);
    stats.scripts = scriptUrls.size;
    // Worker scripts show up in resource timing as "other"; one that builds FontFaces is a reason to re-run
    // the page with worker capture (fonts made in a worker never reach this document)
    const workerScripts = new Set(rtEntries.filter(({ e }) => e.initiatorType === "other" && /\.m?js(\?|#|$)/i.test(e.name)).map(({ e }) => e.name));
    let workerFonts = false;
    await pool([...scriptUrls].filter(u => /^https?:/.test(u)).slice(0, 150), 8, async url => {
      try {
        const text = await fetchText(url, 8000);
        if (text.length < 20e6) texts.push({ text, base: url });
        if (workerScripts.has(url) && /FontFace\s*\(/.test(text)) workerFonts = true;
      } catch {}
    }, 8000, slice(18, 34));

    const fontDirs = new Set([...claimed, ...[...candidates.keys()].filter(u => FONT_EXT.test(u))]
      .filter(u => /^https?:/.test(u)).map(u => u.replace(/[^/]*$/, "")));
    const stripQuery = u => u.split(/[?#]/)[0];
    const knownBare = () => new Set([...claimed, ...candidates.keys()].map(stripQuery));
    const sourceRefs = new Map(); // path|base -> { path, bases, family }
    const embedded = new Set(); // base64 strings
    const cssRefs = new Set(); // stylesheet URLs mentioned in source (lazy-loaded, in <template>, …)
    const scanText = ({ text, base }) => {
      text = text.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/\\(["'])/g, "$1").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (/@font-face/i.test(text)) {
        const parsed = parseCssText(text, base);
        parsed.localOnly.forEach(f => localFamilies.add(f));
        for (const f of parsed.faces) {
          if (!f.urls.some(u => claimed.has(u))) { add(f.family, f.urls, f.style, "CSS @font-face", undefined); f.urls.forEach(u => claimed.add(u)); }
        }
      }
      if (/FontFace/.test(text)) {
        for (const [, , family, u] of text.matchAll(/FontFace\(\s*(["'`])([^"'`]{1,100})\1\s*,\s*["'`]\s*url\(\s*["']?([^"')\s]+)/g)) {
          sourceRefs.set(u + "|" + base, { path: u, bases: [base], family: cleanFamily(family) });
        }
      }
      for (const [, path] of text.matchAll(/["'(\s=]((?:https?:)?[^"'()\s<>\\]*?\.(?:woff2?|ttf|otf))(?=[?#"'()\s\\]|$)/gi)) {
        const key = path + "|" + base;
        if (!sourceRefs.has(key)) sourceRefs.set(key, { path, bases: [base] });
      }
      // Quoted URL-shaped literals only: minified JS is full of "x.css" property accesses
      for (const [, path] of text.matchAll(/["'`(]\s*((?:https?:)?[\w\-.~%@/]*[\w\-~%@]\.css)(?=[?#"'`)])/gi)) cssRefs.add(path + "\n" + base);
      // String constants naming a font folder ("/assets/fonts/"): bases for bare file names built in JS
      for (const [, dir] of text.matchAll(/["'`]((?:https?:\/\/|\.{0,2}\/)[^"'`\s<>]*fonts?\/)["'`]/gi)) {
        try { fontDirs.add(new URL(dir, base).href); } catch {}
      }
      // base64 of each font signature: wOF2, wOFF, OTTO, 00010000, true
      for (const [b] of text.matchAll(/(?:d09GMg|d09GRg|T1RUTw|AAEAAA|dHJ1ZQ)[A-Za-z0-9+/]{300,}={0,2}/g)) embedded.add(b);
    };
    setSplash(`Scanning ${texts.length} texts…`);
    stats.textBytes = texts.reduce((n, x) => n + x.text.length, 0);
    const scanned = slice(34, 40);
    texts.forEach((x, i) => { scanText(x); scanned(i + 1, texts.length); });
    setSplash(`Checking ${cssRefs.size} referenced stylesheets…`);
    const cssProgress = slice(40, 45);
    // Stylesheets only mentioned in source: fetch and parse (one level of @import). Relative paths
    // ("static/css/x.css" in a build manifest) are also tried under known stylesheet folders ending in their folder.
    const sheetDirs = [...new Set([...walkedHrefs, ...fetchedSheets].filter(u => /^https?:/.test(u)).map(u => u.replace(/[^/]*$/, "")))];
    const cssTries = ref => {
      const [path, base] = ref.split("\n");
      const out = [];
      const push = (p, b) => { try { const u = new URL(p, b).href; if (/^https?:/.test(u) && !out.includes(u)) out.push(u); } catch {} };
      push(path, base);
      if (!/^([a-z]+:|\/)/i.test(path)) {
        const dir = path.replace(/[^/]*$/, "");
        for (const d of sheetDirs) if (dir && d.endsWith("/" + dir)) push(d.slice(0, d.length - dir.length) + path);
        push(path, document.baseURI);
        push(path, location.origin + "/");
      }
      return out;
    };
    const seenCss = new Set([...walkedHrefs, ...fetchedSheets]);
    for (let depth = 0, queue = [...cssRefs].map(cssTries); depth < 2 && queue.length; depth++) {
      const next = [];
      // Speculative: short timeout, these are often third-party or dead links
      await pool(queue.filter(tries => !tries.some(u => seenCss.has(u))).slice(0, 60), 10, async tries => {
        for (const href of tries) {
          seenCss.add(href);
          let text;
          const t0 = performance.now();
          try { text = await fetchText(href, 5000); } catch { (stats.cssRefTimes ||= []).push([href.slice(-60), "fail", Math.round(performance.now() - t0)]); continue; }
          (stats.cssRefTimes ||= []).push([href.slice(-60), text.length, Math.round(performance.now() - t0)]);
          if (/^\s*</.test(text)) continue; // SPA fallback page, not CSS
          const { faces, imports, localOnly: local } = parseCssText(text, href);
          local.forEach(f => localFamilies.add(f));
          for (const f of faces) if (!f.urls.some(u => claimed.has(u))) { add(f.family, f.urls, f.style, "CSS @font-face"); f.urls.forEach(u => claimed.add(u)); }
          next.push(...imports.map(u => [u]));
          return;
        }
      }, 5000, depth ? undefined : cssProgress);
      queue = next;
    }

    // Pass 7: binary stores — CacheStorage (service-worker caches) and IndexedDB
    setProgress(45);
    setSplash("Checking browser storage…");
    const storeFiles = []; // { url, bytes }
    const blobs = [];
    const sniffStored = (url, value) => {
      if (value instanceof ArrayBuffer) value = new Uint8Array(value);
      else if (ArrayBuffer.isView(value)) value = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (value instanceof Uint8Array && value.length > 12 && MAGIC.includes(tagAt(value, 0))) storeFiles.push({ url, bytes: value.slice() });
    };
    try {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of (await cache.keys()).slice(0, 500)) {
          if (NON_FONT_EXT.test(req.url)) continue;
          try {
            const resp = await cache.match(req);
            if (+(resp.headers.get("content-length") || 0) > 20e6) continue;
            sniffStored(req.url, await resp.arrayBuffer());
          } catch {}
        }
      }
    } catch {}
    try {
      const dbs = await Promise.race([indexedDB.databases(), new Promise((_, rej) => setTimeout(rej, 3000))]);
      for (const { name } of dbs.slice(0, 20)) {
        const db = await new Promise((res, rej) => { setTimeout(rej, 3000); const q = indexedDB.open(name); q.onsuccess = () => res(q.result); q.onerror = rej; q.onupgradeneeded = () => { q.transaction.abort(); rej(); }; });
        for (const storeName of db.objectStoreNames) {
          await new Promise(res => {
            let n = 0;
            const q = db.transaction(storeName).objectStore(storeName).openCursor();
            q.onerror = res;
            q.onsuccess = () => {
              const c = q.result;
              if (!c || n++ > 2000) return res();
              const walk = (v, depth, where) => {
                if (v == null || depth > 4) return;
                if (typeof v === "string") { if (v.length > 400) scanText({ text: v, base: document.baseURI }); return; }
                if (v instanceof Blob) { if (v.size < 20e6) blobs.push({ blob: v, where }); return; }
                if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return sniffStored(where, v);
                if (typeof v === "object") for (const k of Object.keys(v).slice(0, 200)) walk(v[k], depth + 1, where + "/" + k);
              };
              walk(c.value, 0, `indexeddb:${name}/${storeName}/${c.key}`);
              c.continue();
            };
          });
        }
        db.close();
      }
    } catch {}
    for (const { blob, where } of blobs) { try { sniffStored(where, await blob.arrayBuffer()); } catch {} }

    // Pass 8: what the capture hook saw since an earlier run (see installCapture)
    const capFiles = []; // { url, bytes, family? }
    for (const doc of docs) {
      const cap = doc.defaultView.__fontRipperCapture;
      if (!cap) { installCapture(doc.defaultView); continue; }
      cap.faces.forEach(({ family, src, bytes, base }, i) => {
        family = cleanFamily(String(family));
        if (bytes) { if (MAGIC.includes(tagAt(bytes, 0))) capFiles.push({ url: `memory:FontFace("${family}")#${i}`, bytes, family }); return; }
        for (const [, a, b, c] of String(src).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g)) {
          const u = (a ?? b ?? c).trim();
          sourceRefs.set(u + "|captured", { path: u, bases: [base || doc.baseURI], family });
        }
      });
      for (const { url, blob } of cap.blobs) {
        try { const bytes = new Uint8Array(await blob.arrayBuffer()); if (MAGIC.includes(tagAt(bytes, 0))) { capFiles.push({ url, bytes }); knownBytes.set(url, bytes); } } catch {}
      }
    }
    stats.captured = capFiles.length;

    // Absolute paths resolve once; relative ones are also tried against the page and known font folders
    const resolved = new Set();
    const resolveRefs = () => {
      const out = [];
      const bare = knownBare();
      for (const [key, { path, bases, family }] of sourceRefs) {
        if (resolved.has(key)) continue;
        resolved.add(key);
        if (/(^|\/)\.[a-z0-9]+$/i.test(path.split(/[?#]/)[0])) continue; // "/.otf": template leftovers, no file name
        const tries = []; // { url, kind } in order of likelihood
        const push = (p, b, kind) => { try { const url = new URL(p, b).href; if (!tries.some(t => t.url === url)) tries.push({ url, kind }); } catch {} };
        if (/^([a-z]+:|\/)/i.test(path)) bases.forEach(b => push(path, b, "abs"));
        else {
          // "fonts/x/a.woff2" next to a known ".../media/fonts/x/" folder: relative to that folder's root
          const dir = path.replace(/[^/]*$/, "");
          for (const d of fontDirs) if (dir && d.endsWith("/" + dir)) push(d.slice(0, d.length - dir.length) + path, d, "suffix");
          push(path, bases[0], "text");
          push(path, document.baseURI, "page");
          push(path, location.origin + "/", "root");
          for (const d of fontDirs) push(path, d, "dir " + d);
        }
        if (family || !tries.some(t => bare.has(stripQuery(t.url)) || files.has(t.url))) out.push({ tries, family });
      }
      return out;
    };

    // Verify candidates by magic bytes and keep the bytes for naming/matching
    setProgress(50);
    setSplash("Verifying font files…");
    const files = new Map(); // url -> { bytes, source, family? }
    const fetchFont = async url => {
      if (!fontCache.has(url)) fontCache.set(url, get(url).then(async r => {
        if (!r.ok) return {};
        const u8 = new Uint8Array(await r.arrayBuffer());
        if (u8.length > 12 && MAGIC.includes(tagAt(u8, 0))) return { bytes: u8 };
        // Not a font: an extension-less API response may still be a JSON list of font paths
        if (u8.length < 5e6 && /^\s*[[{]/.test(String.fromCharCode(...u8.subarray(0, 16)))) return { json: new TextDecoder().decode(u8) };
        return {};
      }));
      const { bytes, json } = await fontCache.get(url);
      if (json) scanText({ text: json, base: url });
      return bytes || null;
    };
    await pool([...candidates], 6, async ([url, c]) => {
      let bytes = null;
      try { bytes = await fetchFont(url); } catch {}
      if (bytes) files.set(url, { bytes, source: c.source });
      else if (c.knownFont) files.set(url, { bytes: null, source: c.source }); // unreadable (CORS) but clearly a font
    }, Infinity, slice(50, 62));
    // Resolve after resource-timing candidates: JSON responses scanned while verifying them add paths too
    const refCandidates = resolveRefs();
    stats.sourceRefs = refCandidates.length;
    stats.sourceUrls = refCandidates.reduce((n, c) => n + c.tries.length, 0);
    setSplash(`Checking ${refCandidates.length} font paths from page source…`);
    const refProgress = slice(62, 78);
    // A way of resolving that keeps missing (10 misses, no hit) is dropped for the remaining paths
    const kindHits = {}, kindMisses = {};
    const REF_LIMIT = 400;
    let checked = 0;
    const checking = Math.min(refCandidates.length, REF_LIMIT);
    await pool(refCandidates.slice(0, REF_LIMIT), 12, async ({ tries, family }) => {
      if (++checked % 10 === 0) splashText.textContent = `Checking font paths from page source… ${checked}/${checking}`;
      refProgress(checked, checking);
      for (const { url, kind } of tries) {
        if (files.has(url)) { if (family) files.get(url).family = family; return; }
        if (!kindHits[kind] && kindMisses[kind] >= 10) continue;
        let bytes = null;
        try { bytes = await fetchFont(url); } catch {}
        if (bytes) { kindHits[kind] = (kindHits[kind] || 0) + 1; files.set(url, { bytes, source: family ? "script" : "page source", family }); return; }
        kindMisses[kind] = (kindMisses[kind] || 0) + 1;
      }
    });
    stats.kinds = Object.fromEntries(Object.keys({ ...kindHits, ...kindMisses }).map(k => [k.slice(0, 60), `${kindHits[k] || 0}/${kindMisses[k] || 0}`]));
    // Past the limit: list the best-guess URL unverified (still downloadable) rather than drop it
    const unverified = [];
    for (const { tries } of refCandidates.slice(REF_LIMIT)) {
      const best = tries.find(t => kindHits[t.kind]) || (tries[0].kind === "abs" ? tries[0] : null);
      if (best && !files.has(best.url)) unverified.push(best.url);
    }
    if (unverified.length) add("font-ripper-unverified", unverified, `/* ${unverified.length} more font files referenced in page source — not checked (limit ${REF_LIMIT}); not in Download All, select to download as-is */`, "page source", `More files referenced in page source (${unverified.length}, unchecked)`);
    for (const b64 of embedded) {
      try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const magic = tagAt(bytes, 0);
        if (!MAGIC.includes(magic)) continue;
        const url = `data:font/${magic === "wOF2" ? "woff2" : magic === "wOFF" ? "woff" : magic === "OTTO" ? "otf" : "ttf"};base64,${b64}`;
        files.set(url, { bytes, source: "embedded" });
      } catch {}
    }
    for (const { url, bytes } of storeFiles) files.set(url, { bytes, source: "storage" });
    for (const { url, bytes, family } of capFiles) files.set(url, { bytes, source: "captured", family });
    for (const [url, f] of files) if (f.bytes) knownBytes.set(url, f.bytes);

    // Identify files: internal names + content hash (identical bytes = same font)
    setSplash(`Identifying ${files.size} font files…`);
    const identified = slice(78, 88);
    let identifiedCount = 0;
    const identifyTotal = files.size;
    for (const [url, f] of files) {
      identified(++identifiedCount, identifyTotal);
      if (!f.bytes) continue;
      const known = infoCache.get(f.bytes);
      if (known) { Object.assign(f, known); if (!f.info && (f.source === "embedded" || f.source === "storage")) files.delete(url); continue; }
      f.info = await readFontInfo(f.bytes);
      // Base64 hits and stored blobs must parse as real fonts: random base64 can start with a signature
      if (!f.info && (f.source === "embedded" || f.source === "storage")) { files.delete(url); continue; }
      f.hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", f.bytes)), b => b.toString(16).padStart(2, "0")).join("");
      infoCache.set(f.bytes, { info: f.info, hash: f.hash });
    }
    // Identical bytes under another URL: prefer a real, loaded URL; a second loaded URL becomes an alias
    const rank = f => ({ loaded: 0, captured: 1, script: 1, storage: 2, "page source": 3, embedded: 4 })[f.source] ?? 0;
    const byHash = new Map();
    for (const [url, f] of [...files].sort((a, b) => rank(a[1]) - rank(b[1]))) {
      if (!f.hash) continue;
      const first = byHash.get(f.hash);
      if (!first) { byHash.set(f.hash, f); f.aliases = []; continue; }
      if (f.source === "loaded") first.aliases.push(url);
      first.family ||= f.family;
      files.delete(url);
    }
    // Bytes already in hand for a URL a CSS rule points at (e.g. one-time URLs, CacheStorage hits)
    for (const [url, f] of files) if (f.bytes && claimed.has(url)) files.delete(url);

    // Attribute files to JS families. Two independent kinds of evidence:
    //  a) glyph signature: render the file under each JS face's own descriptors/unicode-range and compare
    //     with how the page renders that face — physical proof, wins whenever the face is loaded
    //  b) internal font name vs. JS family name — tie-breaker, and fallback for faces that never loaded
    const jsFamilies = [...new Set(jsFaces.map(j => j.family))];
    const nameHits = f => {
      if (!f.info) return [];
      const strong = new Set([f.info.ps, f.info.full, f.info.family + f.info.subfamily].map(norm));
      const weak = norm(f.info.family);
      const scored = jsFamilies.map(fam => {
        const k = norm(fam.replace(/^_+/, ""));
        return { fam, score: strong.has(k) || strong.has(norm(fam)) ? 2 : k === weak || norm(fam) === weak ? 1 : 0 };
      }).filter(h => h.score);
      const best = Math.max(0, ...scored.map(h => h.score));
      return scored.filter(h => h.score === best).map(h => h.fam);
    };
    const loadedJsFaces = jsFaces.filter(({ face }) => face.status === "loaded").map(j => {
      const siblings = jsFaces.filter(o => o !== j && o.family === j.family && o.face.style === j.face.style && o.face.weight === j.face.weight && o.face.stretch === j.face.stretch).map(o => o.face);
      const probe = probeFor(j.face, siblings);
      return { ...j, probe, sig: signature(faceSpec(j.face, j.family), probe, j.doc), fallback: signature(faceSpec(j.face, "font-ripper-nonexistent"), probe, j.doc) };
    }).filter(j => j.sig.join() !== j.fallback.join());
    const assignments = new Map(); // url -> { families, how }
    let tmpId = 0;
    await pool([...files].filter(([, f]) => f.bytes), 4, async ([url, f]) => {
      const metric = new Set();
      const tmpFaces = new Map();
      // Files the page never loaded can't be behind a loaded face — names are enough for those
      for (const j of f.source === "page source" ? [] : loadedJsFaces) {
        const desc = [j.face.weight, j.face.style, j.face.stretch, j.face.unicodeRange, j.face.featureSettings, j.face.variationSettings, j.face.ascentOverride, j.face.descentOverride, j.face.lineGapOverride, j.face.sizeAdjust].join("|");
        const key = desc + "|" + docs.indexOf(j.doc);
        if (!tmpFaces.has(key)) {
          // Temp copy of the file with the face's descriptors, so synthesis and unicode-range behave identically
          const tmp = "font-ripper-sig-" + tmpId++;
          const d = {};
          // "normal" is the default anyway, and Firefox reports sizeAdjust "normal" but rejects it as input
          for (const k of ["weight", "style", "stretch", "unicodeRange", "featureSettings", "variationSettings", "ascentOverride", "descentOverride", "lineGapOverride", "sizeAdjust"]) if (j.face[k] != null && j.face[k] !== "normal") d[k] = j.face[k];
          let face;
          try { face = new j.doc.defaultView.FontFace(tmp, f.bytes, d); } catch {}
          tmpFaces.set(key, face ? face.load().then(() => { j.doc.fonts.add(face); return { face, tmp, doc: j.doc }; }).catch(() => null) : Promise.resolve(null));
        }
        const t = await tmpFaces.get(key);
        // Compare only characters the file itself has glyphs for: a subset file may cover less than its
        // face's unicode-range, and the page then fills those characters from elsewhere
        if (!t) continue;
        const sig = signature(faceSpec(j.face, t.tmp), j.probe, j.doc);
        const own = sig.map((s, i) => i).filter(i => sig[i] !== j.fallback[i]);
        if (own.length >= 3 && own.every(i => sig[i] === j.sig[i])) metric.add(j.family);
      }
      for (const p of tmpFaces.values()) { const t = await p; if (t) t.doc.fonts.delete(t.face); }
      const byName = nameHits(f);
      if (metric.size) {
        const both = [...metric].filter(fam => byName.includes(fam));
        assignments.set(url, both.length
          ? { families: both, how: "matched by glyph metrics + font name" }
          : { families: [...metric], how: "matched by glyph metrics" });
      } else if (f.family) {
        assignments.set(url, { families: [f.family], how: f.source === "captured" ? "captured when the page created it" : "URL found in a new FontFace() call in page scripts" });
      } else if (byName.length) {
        assignments.set(url, { families: byName, how: "matched by font name only" });
      }
    }, Infinity, slice(88, 98));

    setProgress(98);
    // Emit JS / loaded / page-source files
    const sourceNotes = {
      "page source": "not loaded yet — referenced in page source or scripts",
      script: "URL found in page scripts",
      embedded: "embedded as base64 in page source, scripts or storage",
      storage: "found in browser storage (CacheStorage / IndexedDB)",
      captured: "captured from memory when the page built it",
      loaded: "loaded by the page outside CSS",
    };
    let previewId = 0;
    const previewFaces = new Map(); // group label -> tmp family used for preview
    for (const [url, f] of files) {
      const a = assignments.get(url);
      const internal = f.info ? `${f.info.family} ${f.info.subfamily}`.trim() : "";
      const sourceNote = sourceNotes[f.source];
      if (a) {
        const fams = a.families;
        const ambiguous = fams.length > 1 ? ` · ambiguous: identical glyphs in ${fams.join(", ")}` : "";
        for (const fam of fams) add(fam, [url, ...(f.aliases || [])], `/* JS FontFace, ${a.how}${ambiguous}${f.source !== "loaded" ? " · " + sourceNote : ""}${internal ? " · internal name: " + internal : ""} */`, "JS FontFace");
        continue;
      }
      // Unattributed: group by internal family name, register a preview face with the file's own weight/style
      const label = (f.info && f.info.family) || fileName(url);
      if (!previewFaces.has(label)) previewFaces.set(label, "font-ripper-" + previewId++);
      const family = previewFaces.get(label);
      if (f.bytes) {
        try {
          const face = new FontFace(family, f.bytes, f.info ? { weight: String(f.info.weight), style: f.info.italic ? "italic" : "normal" } : {});
          await face.load();
          document.fonts.add(face);
        } catch {}
      }
      add(family, [url, ...(f.aliases || [])], `/* ${sourceNote}${internal ? " · internal name: " + internal : ""}${f.info ? ` · weight ${f.info.weight}${f.info.italic ? " italic" : ""}` : ""} */`, f.source, label);
    }

    // Families the page registered whose file couldn't be recovered: still worth listing (the preview
    // renders with the page's own face)
    const listed = new Set([...found.values()].map(v => v.family));
    const orphans = new Map();
    for (const { face, family } of allFaces) if (!listed.has(family) && !localFamilies.has(family)) (orphans.get(family) || orphans.set(family, []).get(family)).push(face);
    for (const [family, faces] of orphans) {
      const styles = [...new Set(faces.map(f => `${f.weight} ${f.style}`.replace(" normal", "")))].join(", ");
      add(family, [], `/* registered on the page (${styles}; ${faces.some(f => f.status === "loaded") ? "loaded" : "not loaded"}), file not recoverable: built from in-memory data, loaded by a worker or by a stylesheet this page can't read */`, "unrecovered");
    }

    // Group by family
    const grouped = new Map();
    for (const { family, label, entry } of found.values()) {
      if (!grouped.has(family)) grouped.set(family, { name: label || family, entries: [] });
      grouped.get(family).entries.push(entry);
    }
    const result = [];
    for (const [family, { name, entries }] of grouped.entries()) result.push({ family, name, entries });
    setProgress(100);
    return { fonts: result, foreignFrames, blockedSheets: [...blockedSheets], rtWasFull, orphanCount: orphans.size, workerFonts };
  }

  /* ── ZIP download helpers ── */
  // Minimal ZIP writer (stored, no compression — font files are compressed already). Inline because
  // strict CSP pages block loading a ZIP library from a CDN.
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc32 = u8 => { let c = -1; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function makeZip(entries) { // [{ name, bytes }]
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const header = (size, fields) => { const b = new DataView(new ArrayBuffer(size)); fields.forEach(([o, v, w]) => w === 4 ? b.setUint32(o, v, true) : b.setUint16(o, v, true)); return new Uint8Array(b.buffer); };
    for (const { name, bytes } of entries) {
      const n = enc.encode(name), crc = crc32(bytes), len = bytes.length;
      // version 20, flag 0x800 (UTF-8 names), method 0 (stored), DOS time/date 0 → 1980-01-01
      const common = [[4, 20, 2], [6, 0x800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, len, 4], [22, len, 4], [26, n.length, 2]];
      const local = header(30, [[0, 0x04034b50, 4], ...common]);
      parts.push(local, n, bytes);
      central.push(header(46, [[0, 0x02014b50, 4], [4, 20, 2], ...common.map(([o, v, w]) => [o + 2, v, w]), [42, offset, 4]]), n);
      offset += 30 + n.length + len;
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const end = header(22, [[0, 0x06054b50, 4], [8, entries.length, 2], [10, entries.length, 2], [12, cdSize, 4], [16, offset, 4]]);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "font";
  }

  async function downloadFonts(selectedFonts, statusCb) {
    const zipEntries = [];

    // Count how many families share the same sanitized base name
    const baseCounts = new Map();
    for (const font of selectedFonts) {
      const base = sanitizeName(font.name);
      baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
    }
    // Assign unique folder names: same-base families get _1, _2, …
    const baseIdx = new Map();
    const folderMap = new Map();
    for (const font of selectedFonts) {
      const base = sanitizeName(font.name);
      if (baseCounts.get(base) === 1) {
        folderMap.set(font.family, base);
      } else {
        const idx = (baseIdx.get(base) || 0) + 1;
        baseIdx.set(base, idx);
        folderMap.set(font.family, `${base}_${idx}`);
      }
    }

    // Font CDNs rate-limit (429 without CORS headers surfaces as a network error): retry with backoff,
    // and pause every worker while one is backing off
    let pauseUntil = 0;
    const failed = [];
    const hostFails = {}; // consecutive failures per host: a host that keeps failing gets one try per file
    const fetchBytes = async url => {
      let last = "";
      const host = url.split("/")[2];
      for (let attempt = 0; attempt < ((hostFails[host] || 0) >= 6 ? 1 : 4); attempt++) {
        const wait = pauseUntil - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        try {
          const resp = await get(url, 60000);
          if (resp.ok) { hostFails[host] = 0; return new Uint8Array(await resp.arrayBuffer()); }
          last = "HTTP " + resp.status;
          if (resp.status !== 429 && resp.status < 500) break;
        } catch (e) { last = e.name === "TimeoutError" ? "timeout" : "network/CORS error"; }
        if ((hostFails[host] || 0) < 6) pauseUntil = Math.max(pauseUntil, Date.now() + 1500 * 2 ** attempt);
      }
      hostFails[host] = (hostFails[host] || 0) + 1;
      failed.push(`${url}\t${last}`);
      return null;
    };

    let done = 0, saved = 0;
    await pool(selectedFonts, 4, async font => {
      const folder = folderMap.get(font.family);

      // Collect unique URLs across all entries for this family
      const seenUrls = new Set();
      const urls = [];
      for (const entry of font.entries) {
        for (const url of entry.urls) {
          if (!seenUrls.has(url)) { seenUrls.add(url); urls.push(url); }
        }
      }

      // Fetch each URL (bytes already read during the scan win: one-time URLs, storage, base64);
      // skip identical content, deduplicate filenames within the folder
      const usedFileNames = new Set();
      const usedHashes = new Set();
      for (const url of urls) {
        try {
          const bytes = knownBytes.get(url) || await fetchBytes(url);
          if (!bytes) continue;
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)), b => b.toString(16).padStart(2, "0")).join("");
          if (usedHashes.has(hash)) continue;
          usedHashes.add(hash);
          const magic = bytes.length > 4 ? tagAt(bytes, 0) : "";
          const realExt = { wOF2: ".woff2", wOFF: ".woff", OTTO: ".otf" }[magic] || (MAGIC.includes(magic) ? ".ttf" : "");
          const raw = /^https?:/.test(url) ? fileName(url) : font.name + realExt;
          const sane = sanitizeName(raw);
          const ext = sane.includes(".") ? "." + sane.split(".").pop() : "";
          const stem = ext ? sane.slice(0, -ext.length) : sane;
          let name = sane;
          let c = 1;
          while (usedFileNames.has(name)) name = `${stem}_${c++}${ext}`;
          usedFileNames.add(name);
          zipEntries.push({ name: `${folder}/${name}`, bytes });
          saved++;
        } catch {}
      }

      done++;
      statusCb(`Fetching fonts… ${done}/${selectedFonts.length} (${Math.round(done / selectedFonts.length * 100)} %)`);
    });

    if (failed.length) zipEntries.push({ name: "_not-downloaded.txt", bytes: new TextEncoder().encode(failed.join("\n") + "\n") });
    statusCb("Generating ZIP…");
    const content = makeZip(zipEntries);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = "fonts.zip";
    a.click();
    URL.revokeObjectURL(a.href);
    statusCb(null);
    if (failed.length) statusCb(`${saved} files saved, ${failed.length} failed (listed in _not-downloaded.txt)`, true);
  }

  /* ── Display UI ── */
  let savedOverflow = null;
  function showUI({ fonts, foreignFrames, blockedSheets, rtWasFull, orphanCount, recovered }) {
    if (fonts.length === 0) {
      overlay.remove();
      splashStyle.remove();
      alert("No @font-face fonts with URLs found on this page.");
      return;
    }

    savedOverflow ||= {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow
    };
    const saved = savedOverflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    splashStyle.remove();
    const uiStyle = document.createElement("style");
    uiStyle.setAttribute("type", "text/css");
    uiStyle.textContent = `
      #font-inspector-overlay,#font-inspector-overlay *{all:revert;font-family:sans-serif;box-sizing:border-box;line-height:1.4 !important}
      #font-inspector-overlay .font-preview{line-height:normal !important}
      #font-inspector-overlay{position:fixed;inset:0;z-index:2147483647;overflow-y:auto;overscroll-behavior:contain;padding:64px 20px 20px;background:var(--bg-color,#fff);color:var(--fg-color,#000)}
      #font-inspector-overlay .font-sample{margin-bottom:25px;border-bottom:1px solid var(--fg-color,#000);padding-bottom:10px}
      #font-inspector-overlay .font-title{font-weight:700;font-size:16px;margin-bottom:6px;display:flex;align-items:center;gap:8px}
      #font-inspector-overlay .font-link{text-decoration:none;color:var(--fg-color,#000)}
      #font-inspector-overlay .font-link:hover,#font-inspector-overlay .font-link:focus{text-decoration:underline}
      #font-inspector-overlay .font-preview{font-size:1em;margin:6px 0;white-space:pre-line;outline:none;font-weight:400;font-style:normal;text-decoration:none}
      #font-inspector-overlay details summary{cursor:pointer;font-size:14px}
      #font-inspector-overlay .overlay-btn{background:var(--bg-color,#fff);color:var(--fg-color,#000);border:1px solid var(--fg-color,#000);border-radius:4px;padding:6px 12px;margin-left:10px;cursor:pointer;font-size:14px;user-select:none;transition:background-color .2s,color .2s}
      #font-inspector-overlay .overlay-btn:hover:not(:disabled){background:var(--fg-color,#000);color:var(--bg-color,#fff)}
      #font-inspector-overlay .overlay-btn:disabled{opacity:.4;cursor:default}
      #font-inspector-overlay #close-btn{background:#fff!important;color:#000!important;border:1px solid #000!important;box-shadow:none!important;font-weight:400!important;margin-left:0}
      #font-inspector-overlay #close-btn:hover{background:#000!important;color:#fff!important}
      #font-inspector-overlay .toggle-btn{font-size:14px;width:28px;height:28px;margin-right:6px;border:1px solid var(--fg-color,#000);cursor:pointer;border-radius:4px;background:var(--bg-color,#fff);color:var(--fg-color,#000);transition:background-color .2s,color .2s;user-select:none;display:inline-flex;justify-content:center;align-items:center}
      #font-inspector-overlay .toggle-btn.active{background:var(--fg-color,#000);color:var(--bg-color,#fff)}
      #font-inspector-overlay .toggle-btn.bold{font-weight:700}
      #font-inspector-overlay .toggle-btn.italic{font-style:italic}
      #font-inspector-overlay .toggle-btn.underline{text-decoration:underline}
      #font-inspector-overlay .top-controls{position:fixed;top:10px;right:20px;background:#fff;color:#000;padding:6px 12px;border-radius:6px;font-size:14px;z-index:1000001;display:flex;align-items:center;gap:8px;box-shadow:0 0 5px rgba(0,0,0,.15);user-select:none}
      #font-inspector-overlay .top-controls label{display:flex;align-items:center;gap:4px}
      #font-inspector-overlay .top-controls input[type=color]{width:26px;height:26px;padding:0;border:none;cursor:pointer;background:none;appearance:none}
      #font-inspector-overlay .font-block-controls{margin-top:8px;display:flex;align-items:center;gap:6px}
      #font-inspector-overlay .font-block-controls label{font-size:14px;user-select:none}
      #font-inspector-overlay .font-block-controls input[type=number]{width:60px;padding:3px 6px;font-size:14px;border:1px solid var(--fg-color,#000);border-radius:4px;background:var(--bg-color,#fff);color:var(--fg-color,#000);user-select:text}
      #font-inspector-overlay .font-style-note{font-size:12px;font-style:italic;opacity:.7;margin-left:18px}
      #font-inspector-overlay hr{margin:10px 0;border:none;border-top:1px solid var(--fg-color,#000)}
      #font-inspector-overlay .font-checkbox{width:16px;height:16px;cursor:pointer;flex-shrink:0;accent-color:var(--fg-color,#000)}
      #font-inspector-overlay .frames-note{margin-bottom:25px;border-bottom:1px solid var(--fg-color,#000);padding-bottom:10px;font-size:14px}
      #font-inspector-overlay .dl-status{font-size:13px;opacity:.7;min-width:160px}
    `;
    document.head.appendChild(uiStyle);

    overlay.replaceChildren();
    overlay.removeAttribute("style");

    /* top controls bar */
    const controls = document.createElement("div");
    controls.className = "top-controls";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.className = "overlay-btn";
    closeBtn.id = "close-btn";
    closeBtn.onclick = () => {
      overlay.remove();
      uiStyle.remove();
      document.body.style.overflow = saved.body;
      document.documentElement.style.overflow = saved.html;
      savedOverflow = null;
    };
    controls.appendChild(closeBtn);

    const fgLabel = document.createElement("label");
    const colorInput = value => Object.assign(document.createElement("input"), { type: "color", value });
    const fgInput = colorInput("#000000");
    fgLabel.append("Foreground ", fgInput);
    fgInput.oninput = () => overlay.style.setProperty("--fg-color", fgInput.value);
    controls.appendChild(fgLabel);

    const bgLabel = document.createElement("label");
    const bgInput = colorInput("#ffffff");
    bgLabel.append("Background ", bgInput);
    bgInput.oninput = () => overlay.style.setProperty("--bg-color", bgInput.value);
    controls.appendChild(bgLabel);

    const dlAllBtn = document.createElement("button");
    dlAllBtn.textContent = "Download All";
    dlAllBtn.className = "overlay-btn";
    controls.appendChild(dlAllBtn);

    const dlSelBtn = document.createElement("button");
    dlSelBtn.textContent = "Download Selected (0)";
    dlSelBtn.className = "overlay-btn";
    dlSelBtn.disabled = true;
    controls.appendChild(dlSelBtn);

    const statusEl = document.createElement("span");
    statusEl.className = "dl-status";
    controls.appendChild(statusEl);

    overlay.appendChild(controls);

    /* things the page hides from a bookmarklet — link them so it can be run there instead */
    const addNote = (text, urls = []) => {
      const note = document.createElement(urls.length ? "details" : "div");
      note.className = "frames-note";
      const head = document.createElement(urls.length ? "summary" : "span");
      head.textContent = text;
      note.appendChild(head);
      if (urls.length) {
        const list = document.createElement("ul");
        urls.forEach(src => {
          const li = document.createElement("li");
          li.appendChild(Object.assign(document.createElement("a"), { href: src, target: "_blank", className: "font-link", textContent: src }));
          list.appendChild(li);
        });
        note.appendChild(list);
      }
      overlay.appendChild(note);
      return note;
    };
    const plural = (n, word) => `${n} ${n === 1 ? word : word.replace(/y$/, "ie") + "s"}`;
    if (foreignFrames.length) addNote(`${plural(foreignFrames.length, "cross-origin iframe")} not scanned — open and run the bookmarklet there`, foreignFrames);
    if (blockedSheets.length) addNote(recovered
      ? `${plural(blockedSheets.length, "cross-origin stylesheet")} couldn't be read (no CORS). Fonts they load were looked for by re-running the page hidden; if one is missing, open the stylesheet and run the bookmarklet on it`
      : `${plural(blockedSheets.length, "cross-origin stylesheet")} couldn't be read (no CORS), and Chrome hides the fonts they load — open one and run the bookmarklet on it`, blockedSheets);
    if (orphanCount) addNote(`${plural(orphanCount, "family")} had no recoverable file, even after re-running the page hidden with font capture on (the page may block it, or build fonts in a worker). Capture stays on for this tab: fonts built later — e.g. switching type-tester styles — are caught when you run the bookmarklet again.`);
    if (rtWasFull && !recovered) addNote("The page's resource-timing buffer was full before this ran, so fonts loaded after that left no trace. Reload and run the bookmarklet sooner.");

    const placeholder = `${fonts.length} famil${fonts.length === 1 ? "y" : "ies"} found`;

    /* per-font toggle helpers */
    function applyToggles(preview, controlsEl) {
      preview.style.fontWeight = controlsEl.querySelector(".bold.active") ? "bold" : "normal";
      preview.style.fontStyle = controlsEl.querySelector(".italic.active") ? "italic" : "normal";
      preview.style.textDecoration = controlsEl.querySelector(".underline.active") ? "underline" : "none";
    }

    /* checkbox tracking */
    const checkboxes = [];

    function updateSelBtn() {
      const n = checkboxes.filter(c => c.checked).length;
      dlSelBtn.textContent = `Download Selected (${n})`;
      dlSelBtn.disabled = n === 0;
    }

    function setDownloading(busy) {
      dlAllBtn.disabled = busy;
      dlSelBtn.disabled = busy || checkboxes.filter(c => c.checked).length === 0;
      checkboxes.forEach(c => { c.disabled = busy; });
    }

    statusEl.textContent = placeholder;

    const statusCb = (msg, final) => {
      statusEl.textContent = msg || placeholder;
      if (!msg || final) setDownloading(false);
    };

    dlAllBtn.onclick = async () => {
      setDownloading(true);
      try {
        // The unchecked page-source group can be thousands of guesses: only on explicit selection
        await downloadFonts(fonts.filter(f => f.family !== "font-ripper-unverified"), statusCb);
      } catch (e) {
        statusEl.textContent = "Error: " + e.message;
        setDownloading(false);
      }
    };

    dlSelBtn.onclick = async () => {
      const sel = fonts.filter((_, i) => checkboxes[i] && checkboxes[i].checked);
      setDownloading(true);
      try {
        await downloadFonts(sel, statusCb);
      } catch (e) {
        statusEl.textContent = "Error: " + e.message;
        setDownloading(false);
      }
    };

    /* font entries */
    fonts.forEach((font, fontIdx) => {
      const sample = document.createElement("div");
      sample.className = "font-sample";

      const title = document.createElement("div");
      title.className = "font-title";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "font-checkbox";
      cb.title = "Select for download";
      cb.onchange = updateSelBtn;
      checkboxes[fontIdx] = cb;
      title.appendChild(cb);

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = font.name;
      details.appendChild(summary);

      font.entries.forEach((entry, idx) => {
        const wrap = document.createElement("div");
        const ul = document.createElement("ul");
        entry.urls.forEach(url => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = url;
          a.textContent = url.length > 200 ? url.slice(0, 80) + "…" : url;
          a.target = "_blank";
          a.className = "font-link";
          li.appendChild(a);
          ul.appendChild(li);
        });
        const note = document.createElement("div");
        note.textContent = entry.style.replace(/src\s*:\s*[^;]+;/gi, "").replace(/\s{2,}/g, " ").trim();
        note.className = "font-style-note";
        wrap.appendChild(ul);
        wrap.appendChild(note);
        if (idx > 0) details.appendChild(document.createElement("hr"));
        details.appendChild(wrap);
      });

      title.appendChild(details);
      sample.appendChild(title);

      const preview = document.createElement("div");
      preview.className = "font-preview";
      preview.textContent = "The quick brown fox jumps over the lazy dog\nPříliš žluťoučký kůň úpěl ďábelské ódy";
      preview.style.fontFamily = `"${font.family}"`;
      sample.appendChild(preview);

      const blockControls = document.createElement("div");
      blockControls.className = "font-block-controls";

      ["bold", "italic", "underline"].forEach(type => {
        const btn = document.createElement("button");
        btn.className = "toggle-btn " + type;
        btn.textContent = type.charAt(0).toUpperCase();
        btn.title = "Toggle " + type;
        btn.onclick = () => { btn.classList.toggle("active"); applyToggles(preview, blockControls); };
        blockControls.appendChild(btn);
      });

      const editBtn = document.createElement("button");
      editBtn.textContent = "✎";
      editBtn.title = "Toggle edit example texts";
      editBtn.className = "toggle-btn";
      let editable = false;
      editBtn.onclick = () => {
        editable = !editable;
        preview.contentEditable = editable;
        editBtn.classList.toggle("active", editable);
      };
      blockControls.appendChild(editBtn);

      const sizeLabel = document.createElement("label");
      sizeLabel.title = "Font size (em)";
      sizeLabel.textContent = "Size: ";
      const sizeInput = document.createElement("input");
      sizeInput.type = "number";
      sizeInput.min = "0.1";
      sizeInput.step = "0.1";
      sizeInput.value = "1";
      sizeInput.oninput = () => {
        const v = parseFloat(sizeInput.value);
        if (v && v > 0) preview.style.fontSize = v + "em";
      };
      sizeLabel.appendChild(sizeInput);
      blockControls.appendChild(sizeLabel);

      sample.appendChild(blockControls);
      overlay.appendChild(sample);
    });
  }

  /* ── Run ── */
  // Families without a file (built from memory while loading, or lost to a full resource-timing buffer):
  // re-run the page hidden with capture on, once per tab (it executes the page's scripts again)
  let result = await extractFonts();
  if ((result.orphanCount || result.workerFonts) && !window.__fontRipperRecovered) {
    window.__fontRipperRecovered = true;
    progressShown = 0;
    progressStep = "Step 2 of 2 · ";
    setProgress(0);
    setSplash(result.orphanCount ? `Recovering ${result.orphanCount} font famil${result.orphanCount === 1 ? "y" : "ies"} built from memory…` : "Recovering fonts built inside workers…");
    // Re-running the page takes up to ~15 s: its share is the first 40 %, the rescan the rest
    progressRange = [0, 40];
    const tStart = Date.now();
    const timer = setInterval(() => setProgress(Math.min(99, (Date.now() - tStart) / 15000 * 100)), 250);
    const got = await captureInFrame();
    clearInterval(timer);
    progressRange = [40, 100];
    if (got) result = await extractFonts();
    result.recovered = true;
  }
  showUI(result);
})();
