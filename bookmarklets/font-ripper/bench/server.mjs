// Fixture server on two origins (A = 127.0.0.1, B = localhost) so cross-origin cases are real.
//   /cases/<id>.html            case page          /case-assets/<id>/<file>  case files
//   /fonts/fNN.<ext>            font (CORS *)      /x/fNN                    extension-less woff2
//   /xor/fNN                    XOR-0x5A woff2     /once/fNN.woff2?…         served once, then 403
//   /nocors/<path>              same, without Access-Control-Allow-Origin
//   /flaky/fNN.woff2            429 twice, then the font
//   /px                         tiny empty response (resource-timing filler)
import http from "node:http";
import { cases, fontBytes } from "./cases.mjs";

export function start(portA = 8801, portB = 8802) {
  const A = `http://127.0.0.1:${portA}`, B = `http://localhost:${portB}`;
  const list = cases({ A, B });
  const byId = new Map(list.map(c => [c.id, c]));
  const onceSeen = new Set();
  const flaky = new Map();
  const handler = (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    let cors = true;
    if (url.startsWith("/nocors/")) { cors = false; url = url.slice(7); }
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "max-age=3600", ...(cors ? { "Access-Control-Allow-Origin": "*" } : {}), ...extra });
      res.end(body);
    };
    let m;
    try {
      if ((m = url.match(/^\/cases\/([\w-]+)\.html$/)) && byId.has(m[1])) {
        const c = byId.get(m[1]);
        return send(200, "text/html; charset=utf-8", c.html, { "Cache-Control": "no-store", ...(c.headers || {}) });
      }
      if ((m = url.match(/^\/(?:cases|case-assets\/([\w-]+))\/(.+)$/))) {
        // Case files resolve relative to the case page (/cases/x.html → /cases/<file>) or explicitly
        for (const c of m[1] ? [byId.get(m[1])] : list) {
          const f = c && c.files && c.files[m[2]];
          if (f) return send(200, f.type, f.body);
        }
      }
      if ((m = url.match(/^\/fonts\/f(\d\d)\.(woff2|woff|ttf)$/))) return send(200, "font/" + m[2], fontBytes(+m[1], m[2]));
      if ((m = url.match(/^\/fonts\/.*\(f(\d\d)\)\.woff2$/))) return send(200, "font/woff2", fontBytes(+m[1]));
      if ((m = url.match(/^\/x\/f(\d\d)$/))) return send(200, "application/octet-stream", fontBytes(+m[1]));
      if ((m = url.match(/^\/xor\/f(\d\d)$/))) return send(200, "application/octet-stream", fontBytes(+m[1]).map(b => b ^ 90));
      if ((m = url.match(/^\/once\/f(\d\d)\.woff2$/))) {
        if (onceSeen.has(req.url)) return send(403, "text/plain", "expired", { "Cache-Control": "no-store" });
        onceSeen.add(req.url);
        return send(200, "font/woff2", fontBytes(+m[1]));
      }
      if ((m = url.match(/^\/flaky\/f(\d\d)\.woff2$/))) {
        const n = (flaky.get(url) || 0) + 1;
        flaky.set(url, n);
        if (n <= 2) { cors = false; return send(429, "text/plain", "slow down", { "Cache-Control": "no-store" }); }
        return send(200, "font/woff2", fontBytes(+m[1]));
      }
      if (url === "/px") return send(200, "text/plain", "");
      if (url === "/") return send(200, "text/html", list.map(c => `<a href="/cases/${c.id}.html">${c.id}</a> — ${c.desc}`).join("<br>"));
    } catch (e) { return send(500, "text/plain", String(e)); }
    send(404, "text/plain", "not found");
  };
  const servers = [portA, portB].map(p => http.createServer(handler).listen(p));
  return { A, B, list, resetOnce: () => { onceSeen.clear(); flaky.clear(); }, close: () => servers.forEach(s => s.close()) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = start();
  console.log(`fixtures: ${s.A}/  (cross-origin twin: ${s.B})`);
}
