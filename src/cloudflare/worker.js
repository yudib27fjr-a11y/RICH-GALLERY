/* Rich Gallery POS di Cloudflare.
   - Tampilan (folder public/) dilayani langsung oleh Cloudflare (Workers Static Assets).
   - Semua /api/* diteruskan ke SATU Durable Object "toko" yang memegang database SQLite toko.
     Satu objek = satu database = semua permintaan berurutan, jadi aturan stok & nomor nota tetap aman.
   - Cron tiap 5 menit membangunkan objek untuk mengirim antrean ke Google Sheet. */
import { pasangDriver, migrasi, seedJikaKosong, isiDemo, gantiMerek, demoAktif, jalankan, cariRoute, kirimOutbox, kirimNotif, bersihkanSesiKadaluarsa, hapusFotoAbsenLama, hapusNotaBelanjaLama, terimaEmail, rekapProduksiHarian, cekKontenBaru, pengingatTugasHarian } from "../core/semua.js";
import { mimeKeTeks } from "./email.js";
import { buatDriverDO } from "./driver.js";
import { pasangPlatformCF } from "./platform.js";
import { platform } from "../core/platform.js";

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
    this.demo = false; // objek demo dikenali dari header x-rg-demo yang dipasang Worker (header dari luar selalu dibuang)
  }
  async siapkan(){
    if (this.siap) return;
    pasangPlatformCF();
    this.drv = buatDriverDO(this.state.storage);
    pasangDriver(this.drv);
    migrasi();
    if (this.demo) {
      // Versi demo: tidak ada koneksi keluar (Google Sheet, notifikasi, Instagram, …); tiap pengunjung punya database sendiri
      // yang dihapus otomatis 3 hari kemudian.
      platform.http = async () => { throw new Error("Tidak tersedia di versi demo"); };
      if (await isiDemo()) await this.state.storage.setAlarm(Date.now() + 3 * 86400_000);
      pasangDriver(this.drv);
    } else seedJikaKosong();
    this.siap = true;
  }
  async alarm(){ // hanya demo: database pengunjung dihapus
    pasangDriver(this.drv || (this.drv = buatDriverDO(this.state.storage)));
    let demo = false; try { demo = demoAktif(); } catch { /* tabel belum ada */ }
    if (!demo) return; // database toko asli tidak pernah dihapus
    await this.state.storage.deleteAll();
    this.siap = false; this.siapP = null;
  }

  async fetch(req){
    if (!this.siap) this.demo = req.headers.get("x-rg-demo") === "1";
    if (!this.siap) { this.siapP ||= this.siapkan().finally(() => { this.siapP = null; }); await this.siapP; }
    const url = new URL(req.url);
    if (this.demo && url.pathname.startsWith("/__")) return json(404, { error: "Tidak ada" });
    if (url.pathname === "/__email") { // dari Email Worker (bukan dari internet: hanya /api/* yang diteruskan ke objek ini)
      try { const r = terimaEmail(await req.json()); this.state.waitUntil?.(kirimNotif().catch(() => {})); return json(200, r); }
      catch (e) { console.error("email", e.message); return json(500, { error: e.message }); }
    }
    if (url.pathname === "/__tugas") { // dari cron
      bersihkanSesiKadaluarsa();
      try { hapusFotoAbsenLama(); } catch (e) { console.error("hapus foto absen", e.message); }
      try { hapusNotaBelanjaLama(); } catch (e) { console.error("hapus nota belanja", e.message); }
      await kirimOutbox().catch(() => {});
      try { rekapProduksiHarian(); } catch (e) { console.error("rekap produksi", e.message); }
      try { pengingatTugasHarian(); } catch (e) { console.error("pengingat tugas", e.message); }
      await cekKontenBaru().catch(e => console.error("konten", e.message));
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
        if (teks) { try { body = JSON.parse(teks); } catch { if (/^[\w%.-]+=/.test(teks)) body = Object.fromEntries(new URLSearchParams(teks)); else return json(400, { error: "Format data tidak valid" }); } }
      }
      let cookieKeluar = null;
      // Beberapa objek demo bisa berjalan di isolate yang sama (modul dipakai bersama): pastikan database objek INI yang aktif.
      pasangDriver(this.drv);
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
      if (!this.demo) this.state.waitUntil?.(kirimOutbox().catch(() => {}));
      if (req.method !== "GET" && !this.demo) this.state.waitUntil?.(kirimNotif().catch(e => console.error("notif", e.message))); // kabari HP admin
      if (this.demo) return new Response(gantiMerek(JSON.stringify(hasil.data)), { status: hasil.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADER_AMAN, ...extra } });
      return json(hasil.status, hasil.data, extra);
    } catch (e) {
      return json(e.status || 500, { error: e.status ? e.message : "Terjadi kesalahan di server" });
    }
  }
}

const objekToko = env => env.TOKO.get(env.TOKO.idFromName("toko"));

/* ---------- Versi demo (promosi Yudsky Tech) ---------- */
const OG_DEMO = `<meta property="og:type" content="website"><meta property="og:title" content="Coba Aplikasi Kasir Toko — Demo gratis">
<meta property="og:description" content="Kasir, stok, pesanan, absen wajah, gaji & laporan dalam 1 aplikasi. Coba langsung di HP — dibuat oleh Yudsky Tech.">
<meta property="og:image" content="/demo/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`;
async function demoFetch(req, env, url){
  if (url.pathname.startsWith("/api/")) {
    // Tiap pengunjung: database sendiri (dikenali dari cookie), supaya coba-coba orang lain tidak saling mengganggu.
    let id = parseCookies(req.headers.get("cookie") || "").rg_demo || "", baru = false;
    if (!/^[A-Za-z0-9]{20,40}$/.test(id)) { id = crypto.randomUUID().replace(/-/g, ""); baru = true; }
    const rq = new Request(req); rq.headers.set("x-rg-demo", "1");
    const res = await env.TOKO.get(env.TOKO.idFromName("demo:" + id)).fetch(rq);
    if (!baru) return res;
    const r = new Response(res.body, res);
    r.headers.append("Set-Cookie", `rg_demo=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${3 * 86400}${url.protocol === "https:" ? "; Secure" : ""}`);
    return r;
  }
  const res = await env.ASSETS.fetch(req);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  // Halaman utama: judul & pratinjau tautan (WhatsApp) untuk versi demo
  const og = `${OG_DEMO.replace('content="/demo/og.jpg"', `content="${url.origin}/demo/og.jpg"`)}<meta property="og:url" content="${url.origin}/">`;
  return new HTMLRewriter()
    .on("title", { element(e){ e.setInnerContent("Demo Aplikasi Kasir · Yudsky Tech"); } })
    .on("head", { element(e){ e.append(og, { html: true }); } })
    .transform(res);
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if (/^demo\./.test(url.hostname) || env.DEMO === "1") return demoFetch(req, env, url);
    if (url.pathname.startsWith("/api/")) {
      const r = new Request(req); r.headers.delete("x-rg-demo"); // hanya Worker yang boleh menandai objek demo
      return objekToko(env).fetch(r);
    }
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
