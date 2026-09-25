# font-ripper bookmarklet

A bookmarklet that discovers all `@font-face` fonts on any webpage and displays them with live previews and direct download links.

## Installation

Open **[the install page](https://highda.github.io/vibecode-snippets/font-ripper.html)** and drag the *Font Ripper* button to your bookmarks bar. The page builds the bookmark from `minified.js` on `main` of this repo, so a push here goes live within ~5 minutes (raw.githubusercontent.com cache).

Manual alternative: copy the contents of `minified.js` and paste it as the URL of a new bookmark.

## Usage

Navigate to any webpage and click the bookmark. A full-screen overlay will appear showing all fonts found on the page.

## What it does

**Font discovery — every source combined:**

1. **CSSOM** — `cssRules` of all stylesheets in the page, shadow roots, adopted sheets and same-origin iframes, recursing into `@import` and `@media`/`@supports`/`@layer` blocks.
2. **Inline `<style>` tags** — regex scan for rules the CSSOM may not expose.
3. **CORS-blocked sheets** — fetched and regex-parsed, following their `@import`s.
4. **JS FontFace fonts** — families added via `new FontFace()` + `document.fonts.add()` (typical for type testers). Unloaded ones are loaded so their files become visible.
5. **Resource timing** — every file the page downloaded (fetch/XHR/CSS, any URL shape — also extension-less endpoints like Typekit or `/tester/file/<id>`), verified as a font by magic bytes.
6. **Page source** — font file paths referenced in HTML / embedded JSON (e.g. styles of a type tester that haven't been selected yet), resolved against the page and known font directories and verified by magic bytes.

**Identification:** each non-CSS file's internal names are read from its `name`/`OS/2` tables (WOFF2 via an on-demand brotli decoder from jsDelivr; if CSP blocks it, metrics alone are used). Files are matched to JS families by glyph metrics (advance widths + ink bounds rendered under the face's own weight/style/stretch/unicode-range, probing only code points unique to that face) combined with the internal name as tie-breaker. If a file matches several families, it is listed under all of them and flagged *ambiguous*. Unmatched files are grouped by their internal family name with a working preview. Identical files (same SHA-1) under different URLs are merged.

**Not reachable from a bookmarklet:** cross-origin iframes (listed at the top with links — run the bookmarklet there), fonts created from an `ArrayBuffer` whose bytes were decrypted in JS, and text rendered server-side into images.

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
