# font-ripper bookmarklet

A bookmarklet that discovers all `@font-face` fonts on any webpage and displays them with live previews and direct download links.

## Installation

1. Open `minified.js` and copy the entire contents.
2. Create a new bookmark in your browser.
3. Paste the code as the bookmark URL.

## Usage

Navigate to any webpage and click the bookmark. A full-screen overlay will appear showing all fonts found on the page.

## What it does

**Font discovery — three passes:**

1. **CSS rules** — reads `cssRules` from all stylesheets, including those in shadow DOM roots.
2. **Inline `<style>` tags** — regex-scans `<style>` blocks to catch fonts that may not be exposed via `cssRules`.
3. **CORS-blocked external sheets** — fetches cross-origin stylesheets via `fetch()` and parses them with regex, catching fonts that the browser blocks from JS access.

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
