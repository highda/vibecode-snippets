function createOverlay(fontFaces) {
  if (fontFaces.length === 0) {
    alert("No @font-face fonts with URLs found on this page.");
    return;
  }
  const originalOverflow = {
    body: document.body.style.overflow,
    html: document.documentElement.style.overflow,
  };
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
  const overlay = document.createElement("div");
  overlay.id = "font-inspector-overlay";
  const style = document.createElement("style");
  style.setAttribute("type", "text/css");
  style.textContent = `
    #font-inspector-overlay, #font-inspector-overlay * {
      all: revert;
      font-family: sans-serif;
      box-sizing: border-box;
      line-height: unset !important;
    }
    #font-inspector-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 20px;
      background: var(--bg-color, #fff);
      color: var(--fg-color, #000);
    }
    #font-inspector-overlay .font-sample {
      margin-bottom: 25px;
      border-bottom: 1px solid var(--fg-color, #000);
      padding-bottom: 10px;
    }
    #font-inspector-overlay .font-title {
      font-weight: bold;
      font-size: 16px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #font-inspector-overlay .font-link {
      text-decoration: none;
      color: var(--fg-color, #000);
    }
    #font-inspector-overlay .font-link:hover,
    #font-inspector-overlay .font-link:focus {
      text-decoration: underline;
    }
    #font-inspector-overlay .font-preview {
      font-size: 1em;
      margin: 6px 0;
      white-space: pre-line;
      outline: none;
      font-weight: normal;
      font-style: normal;
      text-decoration: none;
    }
    #font-inspector-overlay details summary {
      cursor: pointer;
      font-size: 14px;
    }
    #font-inspector-overlay .overlay-btn {
      background: var(--bg-color, #fff);
      color: var(--fg-color, #000);
      border: 1px solid var(--fg-color, #000);
      border-radius: 4px;
      padding: 6px 12px;
      margin-left: 10px;
      cursor: pointer;
      font-size: 14px;
      user-select: none;
      transition: background-color 0.2s, color 0.2s;
    }
    #font-inspector-overlay .overlay-btn:hover {
      background: var(--fg-color, #000);
      color: var(--bg-color, #fff);
    }
    #font-inspector-overlay #close-btn {
      background: #fff !important;
      color: #000 !important;
      border: 1px solid #000 !important;
      box-shadow: none !important;
      font-weight: normal !important;
      margin-left: 0;
    }
    #font-inspector-overlay #close-btn:hover {
      background: #000 !important;
      color: #fff !important;
    }
    #font-inspector-overlay .toggle-btn {
      font-size: 14px;
      width: 28px;
      height: 28px;
      margin-right: 6px;
      border: 1px solid var(--fg-color, #000);
      cursor: pointer;
      border-radius: 4px;
      background: var(--bg-color, #fff);
      color: var(--fg-color, #000);
      transition: background-color 0.2s, color 0.2s;
      user-select: none;
      display: inline-flex;
      justify-content: center;
      align-items: center;
    }
    #font-inspector-overlay .toggle-btn.active {
      background: var(--fg-color, #000);
      color: var(--bg-color, #fff);
    }
    #font-inspector-overlay .toggle-btn.bold { font-weight: bold; }
    #font-inspector-overlay .toggle-btn.italic { font-style: italic; }
    #font-inspector-overlay .toggle-btn.underline { text-decoration: underline; }
    #font-inspector-overlay .top-controls {
      position: fixed;
      top: 10px;
      right: 20px;
      background: #fff;
      color: #000;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 1000001;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 0 5px rgba(0,0,0,0.15);
      user-select: none;
    }
    #font-inspector-overlay .top-controls label {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    #font-inspector-overlay .top-controls input[type="color"] {
      width: 26px;
      height: 26px;
      padding: 0;
      border: none;
      cursor: pointer;
      background: none;
      appearance: none;
    }
    #font-inspector-overlay .font-block-controls {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #font-inspector-overlay .font-block-controls label {
      font-size: 14px;
      user-select: none;
    }
    #font-inspector-overlay .font-block-controls input[type="number"] {
      width: 60px;
      padding: 3px 6px;
      font-size: 14px;
      border: 1px solid var(--fg-color, #000);
      border-radius: 4px;
      background: var(--bg-color, #fff);
      color: var(--fg-color, #000);
      user-select: text;
    }
    #font-inspector-overlay .font-style-note {
      font-size: 12px;
      font-style: italic;
      opacity: 0.7;
      margin-left: 18px;
    }
    #font-inspector-overlay hr {
      margin: 10px 0;
      border: none;
      border-top: 1px solid var(--fg-color, #000);
    }
  `;
  document.head.appendChild(style);
  const topControls = document.createElement("div");
  topControls.className = "top-controls";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.className = "overlay-btn";
  closeBtn.id = "close-btn";
  closeBtn.onclick = () => {
    overlay.remove();
    document.body.style.overflow = originalOverflow.body;
    document.documentElement.style.overflow = originalOverflow.html;
  };
  topControls.appendChild(closeBtn);
  const fgLabel = document.createElement("label");
  fgLabel.innerHTML = `Foreground <input type="color" value="#000000">`;
  const fgPicker = fgLabel.querySelector("input");
  fgPicker.oninput = () => overlay.style.setProperty("--fg-color", fgPicker.value);
  topControls.appendChild(fgLabel);
  const bgLabel = document.createElement("label");
  bgLabel.innerHTML = `Background <input type="color" value="#ffffff">`;
  const bgPicker = bgLabel.querySelector("input");
  bgPicker.oninput = () => overlay.style.setProperty("--bg-color", bgPicker.value);
  topControls.appendChild(bgLabel);
  overlay.appendChild(topControls);
  function updatePreviewStyles(preview, controls) {
    preview.style.fontWeight = controls.querySelector(".bold.active") ? "bold" : "normal";
    preview.style.fontStyle = controls.querySelector(".italic.active") ? "italic" : "normal";
    preview.style.textDecoration = controls.querySelector(".underline.active") ? "underline" : "none";
  }
  fontFaces.forEach((font) => {
    const container = document.createElement("div");
    container.className = "font-sample";
    const title = document.createElement("div");
    title.className = "font-title";
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = font.family;
    details.appendChild(summary);
    font.entries.forEach((entry, index) => {
      const entryBlock = document.createElement("div");
      const list = document.createElement("ul");
      entry.urls.forEach((url) => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = url;
        link.textContent = url;
        link.target = "_blank";
        link.className = "font-link";
        li.appendChild(link);
        list.appendChild(li);
      });
      const note = document.createElement("div");
      note.textContent = entry.style.replace(/src\s*:\s*[^;]+;/gi, "").replace(/\s{2,}/g, ' ').trim();
      note.className = "font-style-note";
      entryBlock.appendChild(list);
      entryBlock.appendChild(note);
      if (index > 0) {
        details.appendChild(document.createElement("hr"));
      }
      details.appendChild(entryBlock);
    });
    title.appendChild(details);
    container.appendChild(title);
    const preview = document.createElement("div");
    preview.className = "font-preview";
    preview.textContent =
      "The quick brown fox jumps over the lazy dog\nPříliš žluťoučký kůň úpěl ďábelské ódy";
    preview.style.fontFamily = font.family;
    container.appendChild(preview);
    const controls = document.createElement("div");
    controls.className = "font-block-controls";
    ["bold", "italic", "underline"].forEach((type) => {
      const btn = document.createElement("button");
      btn.className = `toggle-btn ${type}`;
      btn.textContent = type.charAt(0).toUpperCase();
      btn.title = `Toggle ${type}`;
      btn.onclick = () => {
        btn.classList.toggle("active");
        updatePreviewStyles(preview, controls);
      };
      controls.appendChild(btn);
    });
    const editToggleBtn = document.createElement("button");
    editToggleBtn.textContent = "✎";
    editToggleBtn.title = "Toggle edit example texts";
    editToggleBtn.className = "toggle-btn";
    let editable = false;
    editToggleBtn.onclick = () => {
      editable = !editable;
      preview.contentEditable = editable;
      editToggleBtn.classList.toggle("active", editable);
    };
    controls.appendChild(editToggleBtn);
    const sizeLabel = document.createElement("label");
    sizeLabel.title = "Font size (em)";
    sizeLabel.textContent = "Size: ";
    const sizeInput = document.createElement("input");
    sizeInput.type = "number";
    sizeInput.min = "0.1";
    sizeInput.step = "0.1";
    sizeInput.value = "1";
    sizeInput.oninput = () => {
      const val = parseFloat(sizeInput.value);
      if (val && val > 0) {
        preview.style.fontSize = val + "em";
      }
    };
    sizeLabel.appendChild(sizeInput);
    controls.appendChild(sizeLabel);
    container.appendChild(controls);
    overlay.appendChild(container);
  });
  document.body.appendChild(overlay);
}
function extractFontFaces() {
  const fontMap = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      continue; // skip CORS-restricted stylesheets
    }
    if (!rules) continue;
    // Determine base URL for relative paths
    const baseURL = sheet.href ? new URL(sheet.href, document.baseURI) : new URL(document.baseURI);
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const style = rule.style;
        const family = style.getPropertyValue('font-family').replace(/["']/g, '').trim();
        const srcParts = [];
        for (let i = 0; i < style.length; i++) {
          const prop = style[i];
          if (prop === 'src') {
            srcParts.push(style.getPropertyValue(prop));
          }
        }
        if (srcParts.length === 0) continue;
        const combinedSrc = srcParts.join(', ');
        // Extract and resolve URLs
        const urls = [];
        combinedSrc.replace(/url\(([^)]+)\)/g, (_, rawUrl) => {
          const cleanedUrl = rawUrl.replace(/["']/g, '').trim();
          try {
            const absUrl = new URL(cleanedUrl, baseURL).href;
            urls.push(absUrl);
          } catch (e) {
            // Skip malformed URL
          }
        });
        if (urls.length === 0) continue;
        const sortedUrls = urls.slice().sort();
        const styleText = style.cssText;
        const key = family + '|' + sortedUrls.join(',') + '|' + styleText;
        if (!fontMap.has(key)) {
          fontMap.set(key, { family, entry: { urls, style: styleText } });
        }
      }
    }
  }
  // Group by family
  const fontsByFamily = new Map();
  for (const { family, entry } of fontMap.values()) {
    if (!fontsByFamily.has(family)) fontsByFamily.set(family, []);
    fontsByFamily.get(family).push(entry);
  }
  const fonts = [];
  for (const [family, entries] of fontsByFamily.entries()) {
    fonts.push({ family, entries });
  }
  return fonts;
}
// Run
createOverlay(extractFontFaces());
