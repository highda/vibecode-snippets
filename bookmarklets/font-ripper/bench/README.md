# font-ripper benchmark

Two harnesses, both drive Playwright's Chromium (`npx -y -p playwright@1.63.0`, or set `PLAYWRIGHT_PATH` to a `playwright` package dir) and judge the bookmarklet by the ZIP that **Download All** produces.

```sh
python3 bench/make-fonts.py          # once: 80 distinct test fonts → bench/fonts/ (git-ignored)
node bench/run-fixtures.mjs          # fixture pages, one per font delivery vector
node bench/run-live.mjs --jobs=4     # live foundry sites
```

Options: `--min` tests `minified.js` instead of `full_code.js`, `--headed` shows the browser, other arguments filter cases/sites by substring. `run-fixtures.mjs --browser=firefox|webkit` runs another engine (`npx -y -p playwright@1.63.0 playwright install firefox webkit` once). `run-live.mjs --robust` runs a set of general, non-foundry sites (CSP, Trusted Types, big SPAs, no web fonts at all) to check nothing crashes or hangs; `--verbose` adds orphan/attribution details. `run-live.mjs --dl=<s>` sets the download timeout. `node bench/probe.mjs <case>` prints a fixture's resource timing and `document.fonts`.

## Fixtures (`cases.mjs`, `server.mjs`)

Each case page gets its own fonts `fNN` (internal name `Int NN`, glyph widths scaled per font so files are byte- and metric-distinct), registered on the page as `Vec NN`. The server runs on two origins (`127.0.0.1:8801`, `localhost:8802`) so cross-origin cases are real, and has routes for extension-less, XOR-obfuscated, one-time, CORS-less and rate-limited (429) fonts.

Per expected font: `✔` byte-identical file in the ZIP (`ᵘ` = only under its internal name, not the page's family), `~` URL listed but not downloadable, `?` family listed without a file, `✘` missed. `(hard)` cases need the capture hook / recovery frame. A case with `second` runs the bookmarklet, clicks an element, and runs it again.

Last results (2026-09-27): Chromium 73/74, Firefox 73/74, WebKit 69/74 files in the ZIP, all attributed to the right family. The one miss everywhere is `nocors-font` (a CORS-less font no page can use); WebKit also misses the no-CORS stylesheet cases and the one-time URL.

## Live sites (`run-live.mjs`)

Ground truth: every network response whose first bytes are a font signature, split into fonts the page loaded itself (before the run) and fonts the bookmarklet pulled in (`+N`), plus a `FontFace` hook for attribution checks. Reported per site: listed/total page fonts, how many are byte-identical in the ZIP, JS FontFace attribution (right / unattributed / wrong), run time, slow phases (from `window.__fontRipperStats`), orphan families and the download status line when files failed.
