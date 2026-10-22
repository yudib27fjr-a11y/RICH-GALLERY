/* Rich Gallery POS di Cloudflare.
   - Tampilan (folder public/) dilayani langsung oleh Cloudflare (Workers Static Assets).
   - Semua /api/* diteruskan ke SATU Durable Object "toko" yang memegang database SQLite toko.
     Satu objek = satu database = semua permintaan berurutan, jadi aturan stok & nomor nota tetap aman.
   - Cron tiap 5 menit membangunkan objek untuk mengirim antrean ke Google Sheet. */
import { pasangDriver, migrasi, seedJikaKosong, jalankan, cariRoute, kirimOutbox, kirimNotif, bersihkanSesiKadaluarsa, hapusFotoAbsenLama, terimaEmail, rekapProduksiHarian } from "../core/semua.js";
import { mimeKeTeks } from "./email.js";
import { buatDriverDO } from "./driver.js";
import { pasangPlatformCF } from "./platform.js";

const COOKIE = "rg_sid";
const HEADER_AMAN = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(self)",
};

function parseCookies(h = ""){
  const o = {};
  for (const p of h.split(";")) { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return o;
}
const json = (status, data, extra = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADER_AMAN, ...extra } });

/** Durable Object: satu-satunya pemegang database toko. */
export class Toko {
  constructor(state, env){
    this.state = state;
    this.env = env;
    this.siap = false;
  }
  siapkan(){
    if (this.siap) return;
    pasangPlatformCF();
    pasangDriver(buatDriverDO(this.state.storage));
    migrasi();
    seedJikaKosong();
    this.siap = true;
  }

  async fetch(req){
    this.siapkan();
    const url = new URL(req.url);
    if (url.pathname === "/__email") { // dari Email Worker (bukan dari internet: hanya /api/* yang diteruskan ke objek ini)
      try { const r = terimaEmail(await req.json()); this.state.waitUntil?.(kirimNotif().catch(() => {})); return json(200, r); }
      catch (e) { console.error("email", e.message); return json(500, { error: e.message }); }
    }
    if (url.pathname === "/__tugas") { // dari cron
      bersihkanSesiKadaluarsa();
      try { hapusFotoAbsenLama(); } catch (e) { console.error("hapus foto absen", e.message); }
      await kirimOutbox().catch(() => {});
      try { rekapProduksiHarian(); } catch (e) { console.error("rekap produksi", e.message); }
      await kirimNotif().catch(() => {});
      return json(200, { ok: true });
    }
    try {
      // Lindungi dari permintaan lintas situs: semua perubahan data wajib membawa header khusus aplikasi.
      const r = cariRoute(req.method, url.pathname);
      // (kecuali alamat untuk mesin, mis. mesin absen, yang dilindungi kunci rahasia di alamatnya)
      if (req.method !== "GET" && req.headers.get("x-rg") !== "1" && !(r && r.opsi.tanpaRG)) return json(403, { error: "Permintaan ditolak" });
      let body = {};
      if (req.method !== "GET" && r) {
        const panjang = +req.headers.get("content-length") || 0;
        if (panjang > r.batas) return json(413, { error: "Data terlalu besar" });
        const teks = await req.text();
        if (teks.length > r.batas) return json(413, { error: "Data terlalu besar" });
        if (teks) { try { body = JSON.parse(teks); } catch { return json(400, { error: "Format data tidak valid" }); } }
      }
      let cookieKeluar = null;
      const hasil = await jalankan({
        method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body,
        token: parseCookies(req.headers.get("cookie") || "")[COOKIE] || null,
        ip: req.headers.get("cf-connecting-ip") || "",
        setSesi: (token, umur) => { cookieKeluar = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${umur}${url.protocol === "https:" ? "; Secure" : ""}`; },
      });
      const extra = cookieKeluar ? { "Set-Cookie": cookieKeluar } : {};
      if (hasil.unduh) {
        return new Response(hasil.unduh.isi, { status: 200, headers: { "Content-Type": hasil.unduh.tipe, "Content-Disposition": `attachment; filename="${hasil.unduh.nama}"`, "Cache-Control": "no-store", ...HEADER_AMAN, ...extra } });
      }
      // Ada antrean Google Sheet: kirim sebentar lagi (tanpa menahan jawaban ke kasir).
      this.state.waitUntil?.(kirimOutbox().catch(() => {}));
      if (req.method !== "GET") this.state.waitUntil?.(kirimNotif().catch(e => console.error("notif", e.message))); // kabari HP admin
      return json(hasil.status, hasil.data, extra);
    } catch (e) {
      return json(e.status || 500, { error: e.status ? e.message : "Terjadi kesalahan di server" });
    }
  }
}

const objekToko = env => env.TOKO.get(env.TOKO.idFromName("toko"));

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return objekToko(env).fetch(req);
    return env.ASSETS.fetch(req);
  },
  /** Email ke belanja@richgallery.my.id (Cloudflare Email Routing → Worker ini): pesanan Shopee dicatat sebagai belanja. */
  async email(message, env, ctx){
    try {
      const raw = await new Response(message.raw).text();
      const isi = mimeKeTeks(raw);
      await objekToko(env).fetch("https://toko/__email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...isi, dari: isi.dari || message.from }) });
    } catch (e) { console.error("email masuk", e.message); }
  },
  async scheduled(_event, env, ctx){
    ctx.waitUntil(objekToko(env).fetch("https://toko/__tugas"));
  },
};
