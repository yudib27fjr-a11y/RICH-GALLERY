/* Insentif buat konten — otomatis dari Instagram & TikTok toko.
   - Akun Instagram (profesional: bisnis/kreator) & TikTok toko disambungkan sekali oleh admin (login resmi / OAuth).
   - Server memeriksa unggahan baru berkala. Setiap VIDEO baru (Instagram: video/reels di feed, TikTok: video) dicatat.
   - Video yang sama diunggah di Instagram dan TikTok hanya dihitung SATU kali (dicocokkan dari waktu unggah & teks keterangan).
   - Insentif per video (Pengaturan → ins_konten, bawaan Rp5.000) untuk karyawan pembuat konten, maksimal N video per minggu (Senin–Minggu).
   - Unggahan sebelum akun disambungkan tidak dihitung. HP admin mendapat notifikasi setiap ada konten baru. */
import { route } from "../router.js";
import { one, all, run, tx, getSettings, setSetting } from "../db.js";
import { HttpError, bad, notFound, teks, angka, sekarang } from "../util.js";
import { platform } from "../platform.js";
import { antreNotif } from "../notif.js";
import { antre } from "../stok.js";

const NAMA = { instagram: "Instagram", tiktok: "TikTok", manual: "Manual" };
const IG_API = "https://graph.instagram.com/v21.0";
const rp = n => "Rp" + Math.round(n || 0).toLocaleString("id-ID");

/* ---------- waktu ---------- */
/** Tanggal (YYYY-MM-DD) di zona waktu toko dari waktu (ms). */
function tglLokal(ms){
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: platform.zona, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(ms));
}
/** Senin & Minggu dari minggu yang memuat tanggal itu. */
export function mingguDari(tgl){
  const d = new Date(tgl + "T00:00:00Z"), hari = (d.getUTCDay() + 6) % 7; // 0 = Senin
  const senin = new Date(d.getTime() - hari * 864e5), minggu = new Date(senin.getTime() + 6 * 864e5);
  return [senin.toISOString().slice(0, 10), minggu.toISOString().slice(0, 10)];
}

/* ---------- pengaturan ---------- */
function setelan(){
  const s = getSettings(), k = s.konten || {};
  return { s, k, nominal: Number(s.ins_konten) || 0, maks: Number(k.maks_minggu) || 5, penerima: k.penerima_id || null };
}
const simpanK = ubah => { const k = { ...(getSettings().konten || {}), ...ubah }; setSetting("konten", k); return k; };
/** Ringkasan aman untuk tampilan admin (tanpa token / kunci rahasia). */
function status(){
  const { k, nominal, maks, penerima } = setelan();
  const [a, b] = mingguDari(sekarang().tgl);
  return {
    nominal, maks_minggu: maks, penerima_id: penerima,
    ig: { app: !!(k.ig_app && k.ig_app.id && k.ig_app.secret), app_id: k.ig_app ? k.ig_app.id : "", tersambung: !!(k.ig && k.ig.token), nama: k.ig ? k.ig.nama : "", galat: k.ig ? k.ig.galat || "" : "", cek: k.ig ? k.ig.cek || "" : "", mulai: k.ig ? k.ig.mulai || "" : "" },
    tt: { app: !!(k.tt_app && k.tt_app.key && k.tt_app.secret), app_key: k.tt_app ? k.tt_app.key : "", tersambung: !!(k.tt && k.tt.refresh), nama: k.tt ? k.tt.nama : "", galat: k.tt ? k.tt.galat || "" : "", cek: k.tt ? k.tt.cek || "" : "", mulai: k.tt ? k.tt.mulai || "" : "" },
    minggu_ini: { dari: a, sampai: b, hitung: (one("SELECT COUNT(*) n FROM konten WHERE status = 'hitung' AND tgl BETWEEN ? AND ?", [a, b]) || {}).n || 0 },
  };
}

/* ---------- mencocokkan video yang sama di dua platform ---------- */
const kataCap = c => new Set(String(c || "").toLowerCase().replace(/[^a-z0-9#@ ]/g, " ").split(/\s+/).filter(w => w.length >= 3));
function mirip(a, b){
  const A = kataCap(a), B = kataCap(b);
  if (A.size < 2 || B.size < 2) return 0;
  let sama = 0; for (const w of A) if (B.has(w)) sama++;
  return sama / Math.min(A.size, B.size);
}
/** Cari konten di platform lain yang kemungkinan video yang sama: diunggah berdekatan & keterangannya mirip. */
function cariKembaran(platformnya, waktuMs, caption, manual = false){
  const calon = all("SELECT id, platform, grup, waktu_ms, caption, status FROM konten WHERE platform != ? AND status != 'batal' AND waktu_ms BETWEEN ? AND ? ORDER BY ABS(waktu_ms - ?)",
    [platformnya, waktuMs - 3 * 864e5, waktuMs + 3 * 864e5, waktuMs]);
  for (const c of calon) {
    if (one("SELECT 1 x FROM konten WHERE grup = ? AND platform = ? AND status != 'batal'", [c.grup, platformnya])) continue; // grup itu sudah punya video dari platform ini
    const selisihJam = Math.abs(c.waktu_ms - waktuMs) / 36e5, m = mirip(c.caption, caption);
    if (m >= 0.5 || (!manual && selisihJam <= 6 && (m >= 0.3 || !String(caption || "").trim() || !String(c.caption || "").trim()))) return c;
  }
  return null;
}

/* ---------- mencatat satu unggahan ---------- */
/** Kode video dari link (Instagram: kode setelah /reel/ /p/ /tv/, TikTok: nomor setelah /video/) — untuk mencocokkan link manual dengan hasil otomatis. */
/* Juga link bagikan pendek: vt.tiktok.com/XXXX, vm.tiktok.com/XXXX, tiktok.com/t/XXXX, instagram.com/share/reel/XXXX. */
export const kodeLink = url => { const u = String(url || "").trim();
  return ((u.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/) || u.match(/\/video\/(\d+)/) || u.match(/(?:vt|vm)\.tiktok\.com\/([\w-]+)/i) || u.match(/tiktok\.com\/t\/([\w-]+)/i) || u.match(/instagram\.com\/share\/(?:\w+\/)?([\w-]+)/i) || [])[1] || ""); };
const platformLink = url => /instagram\.com|instagr\.am/i.test(url) ? "instagram" : /tiktok\.com/i.test(url) ? "tiktok" : null;
const cariLink = (pf, url) => { const k = kodeLink(url); return k ? one("SELECT * FROM konten WHERE platform = ? AND (pid = ? OR url LIKE ?)", [pf, k, `%/${k}%`]) : null; };
/** Catat video baru. Hasil: baris konten (status: hitung | kembar | batas | lama). */
export function catatKonten({ platform: pf, pid, url = "", caption = "", waktuMs, thumb = "", lama = false, oleh = "otomatis", userId = null }){
  return tx(() => {
    const ada = one("SELECT * FROM konten WHERE platform = ? AND pid = ?", [pf, String(pid)]) || cariLink(pf, url);
    if (ada) return { ...ada, baru: false };
    const { nominal, maks, penerima } = setelan();
    const tgl = tglLokal(waktuMs), cap = String(caption || "").slice(0, 600);
    const kembar = lama ? null : cariKembaran(pf, waktuMs, cap, oleh === "manual");
    let st = lama ? "lama" : kembar ? "kembar" : "hitung", insId = null, ke = 0;
    const pembuat = one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [userId || penerima || 0]);
    if (st === "hitung") {
      const [a, b] = mingguDari(tgl);
      ke = ((one("SELECT COUNT(*) n FROM konten WHERE status = 'hitung' AND tgl BETWEEN ? AND ?", [a, b]) || {}).n || 0) + 1;
      if (ke > maks) st = "batas";
    }
    const r = run(`INSERT INTO konten(platform, pid, url, caption, waktu_ms, tgl, thumb, status, grup, user_id, oleh) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [pf, String(pid), String(url).slice(0, 400), cap, waktuMs, tgl, String(thumb).slice(0, 600), st, kembar ? kembar.grup : null, pembuat ? pembuat.id : null, oleh]);
    const id = Number(r.lastInsertRowid);
    if (!kembar) run("UPDATE konten SET grup = ? WHERE id = ?", [id, id]);
    if (st === "hitung" && pembuat && nominal > 0) {
      const ket = `Konten ${NAMA[pf]}: ${cap.split("\n")[0].slice(0, 120) || url}`.slice(0, 200);
      insId = Number(run("INSERT INTO insentif_lain(tgl, user_id, jenis, nominal, ket, oleh, oleh_id) VALUES (?,?,?,?,?,?,NULL)",
        [tgl, pembuat.id, "konten", nominal, ket, "Otomatis " + NAMA[pf]]).lastInsertRowid);
      run("UPDATE konten SET insentif_id = ? WHERE id = ?", [insId, id]);
      antre("insentif_lain", [[tgl, pembuat.nama, "Buat konten", nominal, ket, "Otomatis " + NAMA[pf]]]);
    }
    if (!lama) {
      const awal = cap.split("\n")[0].slice(0, 80) || "(tanpa keterangan)";
      const isi = st === "hitung" ? (pembuat ? `Insentif ${rp(nominal)} untuk ${pembuat.nama} · video ke-${ke} dari maks ${maks} minggu ini` : "Belum ada penerima insentif konten — atur di Pengaturan")
        : st === "kembar" ? `Video yang sama dengan unggahan di ${NAMA[kembar.platform] || "platform lain"} — tidak dihitung lagi`
        : `Batas ${maks} video minggu ini sudah tercapai — tidak dihitung`;
      antreNotif(`🎬 Konten baru di ${NAMA[pf]}`, `${awal}\n${isi}`, "/#konten?baru=1");
    }
    return { ...one("SELECT * FROM konten WHERE id = ?", [id]), baru: true };
  });
}

/** Ganti pembuat konten (insentifnya ikut pindah bila belum dibayar). */
export function gantiPembuat(id, userId){
  return tx(() => {
    const r = one("SELECT * FROM konten WHERE id = ?", [+id]); if (!r) throw notFound("Konten tidak ditemukan");
    const u = one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+userId]); if (!u) throw bad("Karyawan tidak ditemukan");
    if (r.insentif_id) {
      if (one("SELECT 1 x FROM insentif_lain l JOIN insentif_bayar b ON b.pembuat_id = l.user_id AND l.tgl BETWEEN b.periode_dari AND b.periode_sampai WHERE l.id = ?", [r.insentif_id])) throw bad("Insentif konten ini sudah dibayar");
      run("UPDATE insentif_lain SET user_id = ? WHERE id = ?", [u.id, r.insentif_id]);
    }
    run("UPDATE konten SET user_id = ? WHERE id = ?", [u.id, r.id]);
    return { ok: true, nama: u.nama };
  });
}
/** Karyawan: "Saya yang buat konten ini" — dari link. Bila video sudah tercatat otomatis, pembuatnya diganti; bila belum, dicatat. */
export function klaimKonten(url, user){
  url = teks(url, { wajib: true, max: 400, nama: "Link video" });
  url = url.match(/https?:\/\/\S+/) ? url.match(/https?:\/\/\S+/)[0] : url; // teks bagikan kadang berisi kalimat + link
  const pf = platformLink(url);
  if (!pf || !kodeLink(url)) throw bad("Tempel link video Instagram atau TikTok (bisa link bagikan, mis. https://vt.tiktok.com/…)");
  const ada = cariLink(pf, url);
  if (ada) { if (ada.user_id !== user.id && ada.status !== "batal") gantiPembuat(ada.id, user.id); return { ...one("SELECT * FROM konten WHERE id = ?", [ada.id]), baru: false }; }
  return catatKonten({ platform: pf, pid: kodeLink(url), url, waktuMs: Date.parse(sekarang().tgl + "T12:00:00+08:00"), oleh: "manual", userId: user.id });
}
route("POST", "/api/konten/:id/pembuat", "admin", ({ params, body }) => gantiPembuat(params.id, body.user_id), { pusatSaja: true });

/* ---------- membaca unggahan dari Instagram & TikTok ---------- */
const jsonDari = r => { try { return JSON.parse(r.text || "{}"); } catch { return {}; } };
async function http(method, url, { body, headers } = {}){
  if (!platform.http) throw new Error("Koneksi internet tidak tersedia");
  const r = await platform.http({ method, url, body, headers });
  const j = jsonDari(r);
  if (r.status >= 400 || j.error && (j.error.message || j.error.code && j.error.code !== "ok")) {
    const e = j.error || {}; throw new Error((e.message || e.error_user_msg || j.error_description || `HTTP ${r.status}`).toString().slice(0, 200));
  }
  return j;
}
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

async function cekInstagram(k){
  let ig = k.ig;
  // Token 60 hari diperpanjang otomatis bila tinggal < 15 hari.
  if (ig.kadaluarsa && ig.kadaluarsa - Date.now() < 15 * 864e5) {
    try { const j = await http("GET", `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(ig.token)}`);
      ig = { ...ig, token: j.access_token, kadaluarsa: Date.now() + (j.expires_in || 5184000) * 1000 }; } catch { /* coba lagi lain kali */ }
  }
  const j = await http("GET", `${IG_API}/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url&limit=25&access_token=${encodeURIComponent(ig.token)}`);
  let baru = 0;
  for (const m of (j.data || []).slice().reverse()) {
    if (m.media_type !== "VIDEO") continue; // hanya video (termasuk reels) yang dihitung
    const waktuMs = Date.parse(String(m.timestamp).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const r = catatKonten({ platform: "instagram", pid: m.id, url: m.permalink, caption: m.caption, waktuMs, thumb: m.thumbnail_url, lama: waktuMs < (ig.mulai_ms || 0) });
    if (r.baru) baru++;
  }
  return { ig: { ...ig, galat: "", cek: `${sekarang().tgl} ${sekarang().jam}` }, baru };
}
async function tokenTikTok(k){
  let tt = k.tt;
  if (!tt.access || !tt.exp || tt.exp - Date.now() < 10 * 60e3) {
    const j = await http("POST", "https://open.tiktokapis.com/v2/oauth/token/", { headers: FORM,
      body: form({ client_key: k.tt_app.key, client_secret: k.tt_app.secret, grant_type: "refresh_token", refresh_token: tt.refresh }) });
    tt = { ...tt, access: j.access_token, exp: Date.now() + (j.expires_in || 86400) * 1000, refresh: j.refresh_token || tt.refresh };
  }
  return tt;
}
async function cekTikTok(k){
  const tt = await tokenTikTok(k);
  const j = await http("POST", "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,cover_image_url",
    { headers: { Authorization: `Bearer ${tt.access}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }) });
  let baru = 0;
  for (const v of ((j.data && j.data.videos) || []).slice().reverse()) {
    const waktuMs = Number(v.create_time) * 1000;
    const r = catatKonten({ platform: "tiktok", pid: v.id, url: v.share_url, caption: v.video_description || v.title, waktuMs, thumb: v.cover_image_url, lama: waktuMs < (tt.mulai_ms || 0) });
    if (r.baru) baru++;
  }
  return { tt: { ...tt, galat: "", cek: `${sekarang().tgl} ${sekarang().jam}` }, baru };
}
/** Dipanggil berkala (cron). Memeriksa paling sering tiap 15 menit (atau langsung bila paksa). */
export async function cekKontenBaru({ paksa = false } = {}){
  if (platform.perangkat) return { baru: 0 };
  const k = getSettings().konten || {};
  if (!paksa && k.terakhir && Date.now() - k.terakhir < 15 * 60e3) return { baru: 0 };
  if (!(k.ig && k.ig.token) && !(k.tt && k.tt.refresh)) return { baru: 0 };
  simpanK({ terakhir: Date.now() });
  let baru = 0;
  if (k.ig && k.ig.token) {
    try { const r = await cekInstagram(k); baru += r.baru; simpanK({ ig: r.ig }); }
    catch (e) { simpanK({ ig: { ...k.ig, galat: e.message, cek: `${sekarang().tgl} ${sekarang().jam}` } }); }
  }
  if (k.tt && k.tt.refresh && k.tt_app) {
    try { const r = await cekTikTok(getSettings().konten); baru += r.baru; simpanK({ tt: r.tt }); }
    catch (e) { simpanK({ tt: { ...(getSettings().konten.tt), galat: e.message, cek: `${sekarang().tgl} ${sekarang().jam}` } }); }
  }
  return { baru };
}

/* ---------- menyambungkan akun (OAuth) ---------- */
/** Alamat kembali setelah login di Instagram/TikTok: halaman utama aplikasi (didaftarkan sama persis di aplikasi Meta/TikTok). */
const alamatKembali = asal => String(asal || "").replace(/\/+$/, "") + "/";
route("POST", "/api/konten/mulai-sambung", "admin", ({ body }) => {
  const k = getSettings().konten || {}, pf = body.platform === "tiktok" ? "tt" : "ig";
  const asal = teks(body.asal, { wajib: true, max: 200, nama: "Alamat aplikasi" });
  if (!/^https:\/\/[^/]+$/.test(asal.replace(/\/+$/, ""))) throw bad("Sambungkan dari alamat https aplikasi (mis. https://pos.richgallery.my.id)");
  const state = `${pf}_${platform.token().slice(0, 24)}`;
  simpanK({ state, state_ms: Date.now(), asal: alamatKembali(asal) });
  if (pf === "ig") {
    if (!k.ig_app || !k.ig_app.id) throw bad("Isi App ID & App Secret Instagram dulu");
    return { url: `https://www.instagram.com/oauth/authorize?${form({ client_id: k.ig_app.id, redirect_uri: alamatKembali(asal), response_type: "code", scope: "instagram_business_basic", state })}` };
  }
  if (!k.tt_app || !k.tt_app.key) throw bad("Isi Client key & Client secret TikTok dulu");
  return { url: `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: k.tt_app.key, scope: "user.info.basic,video.list", response_type: "code", redirect_uri: alamatKembali(asal), state })}` };
}, { pusatSaja: true });

route("POST", "/api/konten/sambung", "admin", async ({ body }) => {
  const k = getSettings().konten || {};
  const code = teks(body.code, { wajib: true, max: 1000, nama: "Kode" }), state = teks(body.state, { wajib: true, max: 100, nama: "state" });
  if (!k.state || state !== k.state || Date.now() - (k.state_ms || 0) > 30 * 60e3) throw bad("Sesi menyambungkan sudah kedaluwarsa. Ulangi dari Pengaturan.");
  const redirect = k.asal, mulaiMs = Date.now();
  if (state.startsWith("ig_")) {
    const t = await http("POST", "https://api.instagram.com/oauth/access_token", { headers: FORM,
      body: form({ client_id: k.ig_app.id, client_secret: k.ig_app.secret, grant_type: "authorization_code", redirect_uri: redirect, code: code.replace(/#_$/, "") }) });
    const p = await http("GET", `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(k.ig_app.secret)}&access_token=${encodeURIComponent(t.access_token)}`);
    const me = await http("GET", `${IG_API}/me?fields=user_id,username&access_token=${encodeURIComponent(p.access_token)}`).catch(() => ({}));
    simpanK({ state: null, ig: { token: p.access_token, kadaluarsa: Date.now() + (p.expires_in || 5184000) * 1000, nama: me.username ? "@" + me.username : "Instagram", mulai_ms: mulaiMs, mulai: `${sekarang().tgl} ${sekarang().jam}` } });
  } else {
    const t = await http("POST", "https://open.tiktokapis.com/v2/oauth/token/", { headers: FORM,
      body: form({ client_key: k.tt_app.key, client_secret: k.tt_app.secret, code, grant_type: "authorization_code", redirect_uri: redirect }) });
    const me = await http("GET", "https://open.tiktokapis.com/v2/user/info/?fields=display_name", { headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => ({}));
    simpanK({ state: null, tt: { access: t.access_token, exp: Date.now() + (t.expires_in || 86400) * 1000, refresh: t.refresh_token, nama: (me.data && me.data.user && me.data.user.display_name) || "TikTok", mulai_ms: mulaiMs, mulai: `${sekarang().tgl} ${sekarang().jam}` } });
  }
  // Catat unggahan yang sudah ada sebagai "lama" (tidak dihitung), supaya hanya video baru yang mendapat insentif.
  await cekKontenBaru({ paksa: true }).catch(() => {});
  return status();
}, { pusatSaja: true });

/* Panggilan balik dari Meta (diisi di Pengaturan login bisnis Instagram): akun mencabut izin / meminta hapus data.
   Isinya signed_request yang ditandatangani App Secret Instagram — diperiksa dulu sebelum dipakai. */
function bacaSignedRequest(sr){
  const k = getSettings().konten || {}, rahasia = k.ig_app && k.ig_app.secret;
  const [sig, isi] = String(sr || "").split(".");
  if (!rahasia || !sig || !isi || !platform.hmac256) throw bad("Permintaan tidak valid");
  const b64 = s => s.replace(/-/g, "+").replace(/_/g, "/");
  const harus = Buffer.from(platform.hmac256(rahasia, isi)).toString("base64").replace(/=+$/, "");
  if (harus !== b64(sig).replace(/=+$/, "")) throw new HttpError(403, "Tanda tangan tidak cocok");
  return JSON.parse(Buffer.from(b64(isi), "base64").toString("utf8"));
}
route("POST", "/api/konten/ig/cabut", false, ({ body }) => { bacaSignedRequest(body.signed_request); simpanK({ ig: null }); antreNotif("📸 Instagram terputus", "Izin aplikasi dicabut dari akun Instagram. Sambungkan lagi di menu Konten bila perlu.", "/#konten?baru=1"); return { ok: true }; }, { tanpaRG: true, pusatSaja: true });
route("POST", "/api/konten/ig/hapus-data", false, ({ body }) => {
  bacaSignedRequest(body.signed_request); simpanK({ ig: null });
  const kode = "RG" + Date.now().toString(36).toUpperCase();
  return { url: "https://pos.richgallery.my.id/", confirmation_code: kode };
}, { tanpaRG: true, pusatSaja: true });
route("POST", "/api/konten/putus", "admin", ({ body }) => { simpanK(body.platform === "tiktok" ? { tt: null } : { ig: null }); return status(); }, { pusatSaja: true });

/* ---------- pengaturan & daftar ---------- */
route("GET", "/api/konten", "admin", ({ query }) => {
  const dari = /^\d{4}-\d{2}-\d{2}$/.test(query.dari || "") ? query.dari : mingguDari(sekarang().tgl)[0];
  const sampai = /^\d{4}-\d{2}-\d{2}$/.test(query.sampai || "") ? query.sampai : mingguDari(sekarang().tgl)[1];
  const daftar = all(`SELECT k.id, k.platform, k.url, k.caption, k.tgl, k.waktu_ms, k.thumb, k.status, k.grup, k.user_id, u.nama, k.insentif_id, k.oleh,
    (SELECT nominal FROM insentif_lain WHERE id = k.insentif_id AND dihapus IS NULL) nominal
    FROM konten k LEFT JOIN users u ON u.id = k.user_id WHERE k.tgl BETWEEN ? AND ? AND k.status != 'lama' ORDER BY k.waktu_ms DESC LIMIT 300`, [dari, sampai]);
  return { ...status(), dari, sampai, daftar };
}, { pusatSaja: true });

route("PUT", "/api/konten/setelan", "admin", ({ body }) => {
  const k = getSettings().konten || {}, ubah = {};
  if (body.penerima_id !== undefined) {
    if (body.penerima_id && !one("SELECT 1 x FROM users WHERE id = ? AND aktif = 1", [+body.penerima_id])) throw bad("Karyawan tidak ditemukan");
    ubah.penerima_id = body.penerima_id ? +body.penerima_id : null;
  }
  if (body.maks_minggu != null) ubah.maks_minggu = angka(body.maks_minggu, { min: 1, max: 100, bulat: true, nama: "Maksimal video per minggu" });
  if (body.nominal != null) setSetting("ins_konten", angka(body.nominal, { min: 0, max: 1e7, bulat: true, nama: "Insentif per video" }));
  if (body.ig_app) ubah.ig_app = { id: teks(body.ig_app.id, { max: 60, nama: "App ID Instagram" }), secret: teks(body.ig_app.secret, { max: 120, nama: "App Secret Instagram" }) || (k.ig_app || {}).secret || "" };
  if (body.tt_app) ubah.tt_app = { key: teks(body.tt_app.key, { max: 60, nama: "Client key TikTok" }), secret: teks(body.tt_app.secret, { max: 120, nama: "Client secret TikTok" }) || (k.tt_app || {}).secret || "" };
  simpanK(ubah);
  return status();
}, { pusatSaja: true });

route("POST", "/api/konten/cek", "admin", async () => ({ ...(await cekKontenBaru({ paksa: true })), ...status() }), { pusatSaja: true });

/** Catat manual dari link (bila akun belum disambungkan atau unggahan terlewat). */
route("POST", "/api/konten", "admin", ({ body }) => {
  const url = teks(body.url, { wajib: true, max: 400, nama: "Link video" });
  const pf = platformLink(url);
  if (!pf) throw bad("Tempel link video Instagram atau TikTok");
  const tgl = /^\d{4}-\d{2}-\d{2}$/.test(body.tgl || "") ? body.tgl : sekarang().tgl;
  const waktuMs = Date.parse(tgl + "T12:00:00+08:00");
  const pid = kodeLink(url) || url.replace(/[?#].*$/, "");
  const r = catatKonten({ platform: pf, pid, url, caption: teks(body.ket, { max: 300, nama: "Keterangan" }) || "", waktuMs, oleh: "manual", userId: body.user_id ? +body.user_id : null });
  if (!r.baru) throw bad("Video ini sudah tercatat");
  return r;
}, { pusatSaja: true });

/** Koreksi admin: batalkan (insentif dihapus) atau hitung ulang sebagai video tersendiri. */
route("POST", "/api/konten/:id/status", "admin", ({ params, body }) => tx(() => {
  const r = one("SELECT * FROM konten WHERE id = ?", [+params.id]);
  if (!r) throw notFound("Konten tidak ditemukan");
  const { nominal, penerima } = setelan();
  if (body.status === "batal") {
    if (r.insentif_id) {
      if (one("SELECT 1 x FROM insentif_lain l JOIN insentif_bayar b ON b.pembuat_id = l.user_id AND l.tgl BETWEEN b.periode_dari AND b.periode_sampai WHERE l.id = ?", [r.insentif_id])) throw bad("Insentif periode ini sudah dibayar");
      run("UPDATE insentif_lain SET dihapus = datetime('now') WHERE id = ?", [r.insentif_id]);
    }
    run("UPDATE konten SET status = 'batal', insentif_id = NULL WHERE id = ?", [r.id]);
  } else if (body.status === "hitung") {
    if (r.status === "hitung") return { ok: true };
    const u = one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+(body.user_id || r.user_id || penerima || 0)]);
    if (!u) throw bad("Pilih penerima insentif konten dulu");
    const insId = nominal > 0 ? Number(run("INSERT INTO insentif_lain(tgl, user_id, jenis, nominal, ket, oleh, oleh_id) VALUES (?,?,?,?,?,?,NULL)",
      [r.tgl, u.id, "konten", nominal, `Konten ${NAMA[r.platform]}: ${String(r.caption || r.url).split("\n")[0].slice(0, 120)}`.slice(0, 200), "Admin"]).lastInsertRowid) : null;
    run("UPDATE konten SET status = 'hitung', grup = id, insentif_id = ?, user_id = ? WHERE id = ?", [insId, u.id, r.id]);
  } else throw bad("Status tidak valid");
  return { ok: true };
}), { pusatSaja: true });
