# font-ripper bookmarklet

A bookmarklet that discovers all `@font-face` fonts on any webpage and displays them with live previews and direct download links.

## Installation

Open **[the install page](https://highda.github.io/vibecode-snippets/font-ripper.html)** and drag the *Font Ripper* button to your bookmarks bar. The page builds the bookmark from `minified.js` on `main` of this repo, so a push here goes live within ~5 minutes (raw.githubusercontent.com cache).

Manual alternative: copy the contents of `minified.js` and paste it as the URL of a new bookmark.

## Usage

Navigate to any webpage and click the bookmark. A full-screen overlay will appear showing all fonts found on the page.

## What it does

**Font discovery — every source combined:**

1. **CSSOM** — `cssRules` of all stylesheets in the page, shadow roots, adopted sheets and same-origin iframes / `<object>` / `<embed>` documents (also inside web components' shadow roots; `data:` iframes are decoded and scanned), recursing into `@import` and `@media`/`@supports`/`@layer` blocks.
2. **Inline `<style>` tags** — regex scan for rules the CSSOM may not expose. Run on a bare `.css` file opened in a tab, the whole file is parsed.
3. **CORS-blocked and vanished sheets** — fetched and regex-parsed, following their `@import`s; also stylesheets that were loaded but are gone from the CSSOM (removed `<link>`, closed shadow roots).
4. **JS FontFace fonts** — families added via `new FontFace()` + `document.fonts.add()` (typical for type testers). Unloaded ones are loaded so their files become visible.
5. **Resource timing** — every file the page downloaded (fetch/XHR/CSS, any URL shape — also extension-less endpoints like Typekit or `/tester/file/<id>`), verified as a font by magic bytes.
6. **Page source, scripts, workers, JSON, SVG, web storage** — the live DOM, the original HTML (declarative shadow DOM, `<template>`, `<noscript>`), lazy iframes that haven't loaded yet, JS bundles, worker and service-worker scripts (precache manifests), JSON responses, SVG images and `localStorage`/`sessionStorage` are scanned for `@font-face` CSS (CSS-in-JS), `new FontFace("x", "url(…)")` calls, plain font paths (type-tester style lists), font-folder constants, base64-embedded fonts and stylesheet URLs that were never loaded (lazy tester CSS, other routes' CSS in build manifests), which are fetched and parsed. Paths are resolved against the page, the site root and known font/stylesheet folders; up to 400 font paths are verified by magic bytes, the rest are listed unchecked (not part of Download All).
7. **Browser storage** — CacheStorage (service-worker caches) and IndexedDB records holding font bytes.
8. **Capture & recover** — the first run wraps `FontFace` and `URL.createObjectURL` in the tab, so fonts the page builds from memory afterwards (decrypted bytes, blob: URLs, type-tester style switches) are caught with their bytes on the next run. When families are left without a file, or a worker script builds fonts, the page is automatically re-run once per tab, invisibly, in a sandboxed frame with the hooks already in place (`document.write` into a hooked blank frame keeps the page's URL; workers are started through a boot script that hooks `FontFace` inside them). This recovers fonts decrypted at load time (e.g. Lineto), fonts made inside workers, and — in Chrome and Firefox — fonts loaded by cross-origin stylesheets without CORS, which show up in the fresh frame's resource timing. It re-executes the page's scripts once; Trusted Types or strict hash-based CSP block it.

**Identification:** each non-CSS file's internal names are read from its `name`/`OS/2` tables (WOFF2 via an on-demand brotli decoder from jsDelivr; if CSP blocks it, metrics alone are used). Files are matched to JS families by glyph metrics (advance widths + ink bounds rendered under the face's own weight/style/stretch/unicode-range, probing only code points unique to that face) combined with the internal name as tie-breaker; a URL found in a `new FontFace()` call names its family directly. If a file matches several families, it is listed under all of them and flagged *ambiguous*. Unmatched files are grouped by their internal family name with a working preview. Identical files (same SHA-1) under different URLs are merged. Families the page registered whose file can't be recovered are still listed, previewed with the page's own face.

**Download:** "Download All" / "Download Selected" build a ZIP in the page (no library, so strict-CSP pages work). Bytes already read during the scan are reused, so one-time signed URLs, storage hits and base64 fonts end up in the ZIP too. Rate-limited hosts are retried with backoff; anything that still fails is listed in `_not-downloaded.txt`.

**Not reachable from a bookmarklet:**
- Cross-origin iframes whose server doesn't allow CORS — listed at the top with links; run the bookmarklet there.
- Safari (WebKit) doesn't expose fonts of cross-origin no-CORS stylesheets even in the recovery frame, and doesn't serve `cache: "force-cache"` from its cache, so one-time signed URLs can't be downloaded again there.
- A font file served without CORS can't be read (the page can't use it either).
- Fonts built from memory on a page that blocks the recovery frame (Trusted Types, strict CSP) — the family is listed without a file.
- Text rendered server-side into images.

**Browsers:** tested in Chromium, Firefox and WebKit (Safari engine) with the fixture benchmark.

Fonts are deduplicated and grouped by family name.

**UI features:**

- Expandable per-family list of all font file URLs (clickable, open in new tab)
- CSS descriptor summary (weight, style, unicode-range, etc.) shown beneath each URL list
- Live preview text rendered in the actual font — English pangram + Czech pangram
- Per-font toggles: **Bold**, *Italic*, Underline
- Editable preview text (pencil button)
- Font size control (in em)
- Global foreground/background color pickers for testing contrast
- Close button that restores the page scroll state

## Benchmark

`bench/` holds the test setup; see [bench/README.md](bench/README.md).
