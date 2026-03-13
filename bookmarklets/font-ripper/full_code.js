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
      #font-inspector-overlay .overlay-btn:hover{background:var(--fg-color,#000);color:var(--bg-color,#fff)}
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
    `;
    document.head.appendChild(uiStyle);

    overlay.innerHTML = "";
    overlay.style = "";

    // Top controls
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

    overlay.appendChild(controls);

    function applyToggles(preview, controlsEl) {
      preview.style.fontWeight = controlsEl.querySelector(".bold.active") ? "bold" : "normal";
      preview.style.fontStyle = controlsEl.querySelector(".italic.active") ? "italic" : "normal";
      preview.style.textDecoration = controlsEl.querySelector(".underline.active") ? "underline" : "none";
    }

    // Font entries
    fonts.forEach(font => {
      const sample = document.createElement("div");
      sample.className = "font-sample";

      const title = document.createElement("div");
      title.className = "font-title";

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
      preview.textContent = "The quick brown fox jumps over the lazy dog\nP\u0159\u00edli\u0161 \u017elu\u0165ou\u010dk\u00fd k\u016f\u0148 \u00fap\u011bl \u010f\u00e1belsk\u00e9 \u00f3dy";
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
      editBtn.textContent = "\u270e";
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