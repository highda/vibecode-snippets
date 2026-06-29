javascript:(async()=>{
  /* ── Loading splash ── */
  const overlay = document.createElement("div");
  overlay.id = "font-inspector-overlay";
  const splashStyle = document.createElement("style");
  splashStyle.textContent = `
    #font-inspector-overlay {
      position:fixed;inset:0;z-index:999999;display:flex;align-items:center;
      justify-content:center;background:#fff;color:#000;font-family:sans-serif;
      font-size:18px;
    }
    #font-inspector-overlay .spinner {
      width:20px;height:20px;border:2px solid #ccc;border-top-color:#000;
      border-radius:50%;animation:fi-spin .6s linear infinite;margin-right:12px;
    }
    @keyframes fi-spin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(splashStyle);
  overlay.innerHTML = '<div class="spinner"></div> Loading fonts…';
  document.body.appendChild(overlay);

  /* ── Collect all stylesheets ── */
  function getAllSheets() {
    const sheets = [];
    const addSheet = (sheet, base) => sheets.push({ sheet, base });
    const addRoot = (root, base) => {
      for (const s of root.styleSheets) addSheet(s, base);
      for (const s of (root.adoptedStyleSheets || [])) addSheet(s, base);
    };
    addRoot(document, document.baseURI);
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) addRoot(node.shadowRoot, document.baseURI);
    }
    return sheets;
  }

  /* ── Extract @font-face declarations (async for fetch fallback) ── */
  async function extractFonts() {
    const found = new Map();

    // Pass 1: readable cssRules
    for (const { sheet, base: baseURI } of getAllSheets()) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      const origin = sheet.href ? new URL(sheet.href, baseURI) : new URL(baseURI);
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const style = rule.style;
          const family = style.getPropertyValue("font-family").replace(/["']/g, "").trim();
          const srcs = [];
          for (let i = 0; i < style.length; i++) {
            if (style[i] === "src") srcs.push(style.getPropertyValue(style[i]));
          }
          if (!srcs.length) continue;
          const urls = [];
          srcs.join(", ").replace(/url\(([^)]+)\)/g, (_, u) => {
            const clean = u.replace(/["']/g, "").trim();
            try { urls.push(new URL(clean, origin).href); } catch {}
          });
          if (!urls.length) continue;
          const key = family + "|" + urls.slice().sort().join(",") + "|" + style.cssText;
          if (!found.has(key)) found.set(key, { family, entry: { urls, style: style.cssText } });
        }
      }
    }

    // Pass 2: regex scan inline <style> tags
    for (const styleEl of document.querySelectorAll("style")) {
      const text = styleEl.textContent;
      const blocks = [...text.matchAll(/@font-face\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gi)];
      for (const [, block] of blocks) {
        const fam = (block.match(/font-family\s*:\s*["']?([^;"']+)["']?\s*[;}]/i) || [])[1];
        if (!fam) continue;
        const family = fam.trim();
        const srcM = (block.match(/src\s*:\s*([^;]+(?:;[^}]*)?)(?=\s*(?:font-|unicode-|font-display|ascent|descent|line-gap|\}))/i) || block.match(/src\s*:\s*([^;]+);/i) || [])[1];
        if (!srcM) continue;
        const urls = [];
        srcM.replace(/url\(["']?([^"')]+)["']?\)/g, (_, u) => {
          try { urls.push(new URL(u, document.baseURI).href); } catch {}
        });
        if (!urls.length) continue;
        const key = family + "|" + urls.slice().sort().join(",");
        if (!found.has(key)) found.set(key, { family, entry: { urls, style: block.trim() } });
      }
    }

    // Pass 3: fetch CORS-blocked external sheets
    const fetchPromises = [];
    for (const sheet of document.styleSheets) {
      if (!sheet.href) continue;
      let readable = true;
      try { sheet.cssRules; } catch { readable = false; }
      if (readable) continue;
      fetchPromises.push(
        fetch(sheet.href).then(r => r.text()).then(text => {
          const blocks = [...text.matchAll(/@font-face\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gi)];
          for (const [, block] of blocks) {
            const fam = (block.match(/font-family\s*:\s*["']?([^;"']+)["']?\s*[;}]/i) || [])[1];
            if (!fam) continue;
            const family = fam.trim();
            const urls = [];
            block.replace(/url\(["']?([^"')]+)["']?\)/g, (_, u) => {
              try { urls.push(new URL(u, sheet.href).href); } catch {}
            });
            if (!urls.length) continue;
            const key = family + "|" + urls.slice().sort().join(",");
            if (!found.has(key)) found.set(key, { family, entry: { urls, style: block.trim() } });
          }
        }).catch(() => {})
      );
    }
    await Promise.all(fetchPromises);

    // Group by family
    const grouped = new Map();
    for (const { family, entry } of found.values()) {
      if (!grouped.has(family)) grouped.set(family, []);
      grouped.get(family).push(entry);
    }
    const result = [];
    for (const [family, entries] of grouped.entries()) result.push({ family, entries });
    return result;
  }

  /* ── ZIP download helpers ── */
  async function loadJSZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    return window.JSZip;
  }

  function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "font";
  }

  async function downloadFonts(selectedFonts, statusCb) {
    statusCb("Loading ZIP library…");
    const JSZip = await loadJSZip();
    const zip = new JSZip();

    // Count how many families share the same sanitized base name
    const baseCounts = new Map();
    for (const font of selectedFonts) {
      const base = sanitizeName(font.family);
      baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
    }
    // Assign unique folder names: same-base families get _1, _2, …
    const baseIdx = new Map();
    const folderMap = new Map();
    for (const font of selectedFonts) {
      const base = sanitizeName(font.family);
      if (baseCounts.get(base) === 1) {
        folderMap.set(font.family, base);
      } else {
        const idx = (baseIdx.get(base) || 0) + 1;
        baseIdx.set(base, idx);
        folderMap.set(font.family, `${base}_${idx}`);
      }
    }

    let done = 0;
    await Promise.all(selectedFonts.map(async font => {
      const folder = zip.folder(folderMap.get(font.family));

      // Collect unique URLs across all entries for this family
      const seenUrls = new Set();
      const urls = [];
      for (const entry of font.entries) {
        for (const url of entry.urls) {
          if (!seenUrls.has(url)) { seenUrls.add(url); urls.push(url); }
        }
      }

      // Fetch each URL; deduplicate filenames within the folder
      const usedFileNames = new Set();
      for (const url of urls) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const raw = decodeURIComponent(url.split("/").pop().split("?")[0]) || "font";
          const sane = sanitizeName(raw);
          const ext = sane.includes(".") ? "." + sane.split(".").pop() : "";
          const stem = ext ? sane.slice(0, -ext.length) : sane;
          let name = sane;
          let c = 1;
          while (usedFileNames.has(name)) name = `${stem}_${c++}${ext}`;
          usedFileNames.add(name);
          folder.file(name, blob);
        } catch {}
      }

      done++;
      statusCb(`Fetching fonts… ${done}/${selectedFonts.length}`);
    }));

    statusCb("Generating ZIP…");
    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = "fonts.zip";
    a.click();
    URL.revokeObjectURL(a.href);
    statusCb(null);
  }

  /* ── Display UI ── */
  function showUI(fonts) {
    if (fonts.length === 0) {
      overlay.remove();
      splashStyle.remove();
      alert("No @font-face fonts with URLs found on this page.");
      return;
    }

    const saved = {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    splashStyle.remove();
    const uiStyle = document.createElement("style");
    uiStyle.setAttribute("type", "text/css");
    uiStyle.textContent = `
      #font-inspector-overlay,#font-inspector-overlay *{all:revert;font-family:sans-serif;box-sizing:border-box;line-height:unset !important}
      #font-inspector-overlay{position:fixed;inset:0;z-index:999999;overflow-y:auto;overscroll-behavior:contain;padding:20px;background:var(--bg-color,#fff);color:var(--fg-color,#000)}
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
      #font-inspector-overlay .dl-status{font-size:13px;opacity:.7;min-width:160px}
    `;
    document.head.appendChild(uiStyle);

    overlay.innerHTML = "";
    overlay.style = "";

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
    };
    controls.appendChild(closeBtn);

    const fgLabel = document.createElement("label");
    fgLabel.innerHTML = 'Foreground <input type="color" value="#000000">';
    const fgInput = fgLabel.querySelector("input");
    fgInput.oninput = () => overlay.style.setProperty("--fg-color", fgInput.value);
    controls.appendChild(fgLabel);

    const bgLabel = document.createElement("label");
    bgLabel.innerHTML = 'Background <input type="color" value="#ffffff">';
    const bgInput = bgLabel.querySelector("input");
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

    const statusCb = msg => {
      statusEl.textContent = msg || placeholder;
      if (!msg) setDownloading(false);
    };

    dlAllBtn.onclick = async () => {
      setDownloading(true);
      try {
        await downloadFonts(fonts, statusCb);
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
      summary.textContent = font.family;
      details.appendChild(summary);

      font.entries.forEach((entry, idx) => {
        const wrap = document.createElement("div");
        const ul = document.createElement("ul");
        entry.urls.forEach(url => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = url;
          a.textContent = url;
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
      preview.style.fontFamily = font.family;
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
  const fonts = await extractFonts();
  showUI(fonts);
})();
