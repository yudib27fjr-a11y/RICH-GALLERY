import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { jalankan, cariRoute } from "../core/router.js";

const COOKIE = "rg_sid";
const HEADER_AMAN = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function parseCookies(h = ""){
  const o = {};
  for (const p of h.split(";")) { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return o;
}
function kirimJSON(res, status, data, extra = {}){
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADER_AMAN, ...extra });
  res.end(JSON.stringify(data));
}
async function bacaBody(req, batas){
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > batas) { const e = new Error("Data terlalu besar"); e.status = 413; throw e; } chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const e = new Error("Format data tidak valid"); e.status = 400; throw e; }
}
function ipDari(req){
  if (config.trustProxy) { const f = req.headers["x-forwarded-for"]; if (f) return String(f).split(",")[0].trim(); }
  return req.socket.remoteAddress || "";
}

const TIPE = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".json": "application/json" };
async function kirimStatis(req, res, url){
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || !path.extname(rel)) rel = "/index.html";
  const file = path.resolve(config.publicDir, "." + rel);
  if (!file.startsWith(config.publicDir + path.sep)) { res.writeHead(404, HEADER_AMAN); return res.end(); }
  let st;
  try { st = await stat(file); if (!st.isFile()) throw 0; }
  catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...HEADER_AMAN }); return res.end("Tidak ditemukan"); }
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const head = { "Content-Type": TIPE[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", ETag: etag, ...HEADER_AMAN };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, head); return res.end(); }
  res.writeHead(200, head);
  res.end(await readFile(file));
}

export async function handle(req, res){
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, HEADER_AMAN); return res.end(); }
    return kirimStatis(req, res, url);
  }
  try {
    // Lindungi dari permintaan lintas situs: semua perubahan data wajib membawa header khusus aplikasi.
    const r = cariRoute(req.method, url.pathname);
    // (kecuali alamat untuk mesin, mis. mesin absen, yang dilindungi kunci rahasia di alamatnya)
    if (req.method !== "GET" && req.headers["x-rg"] !== "1" && !(r && r.opsi.tanpaRG)) return kirimJSON(res, 403, { error: "Permintaan ditolak" });
    const body = req.method === "GET" || !r ? {} : await bacaBody(req, r.batas);
    let cookieKeluar = null;
    const hasil = await jalankan({
      method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body,
      token: parseCookies(req.headers.cookie)[COOKIE] || null, ip: ipDari(req),
      setSesi: (token, umur) => { const p = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${umur}`]; if (config.cookieSecure) p.push("Secure"); cookieKeluar = p.join("; "); },
    });
    const extra = cookieKeluar ? { "Set-Cookie": cookieKeluar } : {};
    if (hasil.unduh) {
      res.writeHead(200, { "Content-Type": hasil.unduh.tipe, "Content-Disposition": `attachment; filename="${hasil.unduh.nama}"`, "Cache-Control": "no-store", ...HEADER_AMAN, ...extra });
      return res.end(hasil.unduh.isi);
    }
    kirimJSON(res, hasil.status, hasil.data, extra);
  } catch (e) {
    kirimJSON(res, e.status || 500, { error: e.status ? e.message : "Terjadi kesalahan di server" });
  }
}
