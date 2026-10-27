/* Absensi sidik jari.
   Mesin absen (Fingerspot Revo + layanan developer.fingerspot.io) mengirim setiap scan ke server lewat webhook:
     POST /api/absen/mesin/<kunci-rahasia>   { "type": "attlog", "cloud_id": "...", "data": { "pin": "1", "scan": "2026-10-16 08:01", ... } }
   Setiap karyawan dihubungkan ke mesin lewat "PIN mesin" (nomor ID karyawan di mesin absen).
   Di perangkat cabang (iMin), rekap absensi diambil langsung dari server pusat. */
import { route } from "../router.js";
import { one, all, run, tx, getSettings, setSetting } from "../db.js";
import { platform } from "../platform.js";
import { HttpError, bad, notFound, teks, tanggal, sekarang } from "../util.js";
import { periodeDari, tambahHari } from "../../../public/shared.js";
import { cabangAktif, mintaPusat } from "../cabang-perangkat.js";
import { cekPassword, cekBatasLogin, catatGagal, resetGagal, buatSesi } from "../auth.js";
import { antreNotif } from "../notif.js";

/* ================= Absen PIN + foto selfie dari perangkat kasir di lokasi toko =================
   - Hanya dari aplikasi Android (perangkat kasir) yang tersambung ke server & diizinkan admin untuk absen.
   - Lokasi perangkat saat absen harus dalam radius lokasi toko.
   - Foto selfie wajib; disimpan bersama data absen (dilihat admin di rekap). */
export function jarakMeter(lat1, lng1, lat2, lng2){
  const R = 6371000, r = x => x * Math.PI / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** Periksa lokasi terhadap lokasi toko. Mengembalikan jarak (m) atau melempar galat yang jelas. */
/** Semua titik lokasi absen: lokasi toko utama + lokasi lain (mis. toko kedua). */
export function titikAbsen(s = getSettings()){
  const L = [{ nama: "Toko", lat: parseFloat(s.absen_lat), lng: parseFloat(s.absen_lng) },
    ...(Array.isArray(s.absen_lokasi_lain) ? s.absen_lokasi_lain : []).map(x => ({ nama: String(x.nama || "Lokasi lain"), lat: parseFloat(x.lat), lng: parseFloat(x.lng) }))];
  return L.filter(x => isFinite(x.lat) && isFinite(x.lng));
}
export function cekLokasi(lat, lng, akurasi){
  const s = getSettings(), titik = titikAbsen(s), radius = Number(s.absen_radius) || 100;
  if (!titik.length) throw bad("Lokasi toko untuk absen belum diatur admin (Pengaturan → Absensi)");
  lat = Number(lat); lng = Number(lng); akurasi = Math.max(0, Number(akurasi) || 0);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad("Lokasi perangkat tidak terbaca. Nyalakan GPS / lokasi lalu coba lagi.");
  if (akurasi > 500) throw bad(`Lokasi kurang akurat (±${Math.round(akurasi)} m). Tunggu sebentar di dekat pintu/jendela lalu coba lagi.`);
  const dekat = titik.map(t => ({ ...t, jarak: jarakMeter(lat, lng, t.lat, t.lng) })).sort((a, b) => a.jarak - b.jarak)[0], jarak = dekat.jarak;
  if (jarak > radius + Math.min(akurasi, 50)) throw bad(`Absen hanya bisa di toko. Perangkat berjarak ±${Math.round(jarak)} m dari ${titik.length > 1 ? "lokasi terdekat (" + dekat.nama + ")" : "lokasi toko"} (batas ${radius} m).`);
  return Math.round(jarak);
}
/* HP (browser, mis. iPhone) yang didaftarkan admin untuk absen. Tanda pengenalnya disimpan di HP itu
   dan dikirim saat absen; admin bisa mencabutnya di daftar perangkat seperti perangkat kasir. */
const hpAbsen = token => token ? one("SELECT id, nama, absen FROM perangkat WHERE token_hash = ? AND dicabut IS NULL AND kode LIKE 'W%'", [platform.sha256(String(token))]) : null;
/** Status absen di perangkat ini (untuk tombol Absen di layar kasir / HP absen). */
function statusKiosk(token){
  const s = getSettings();
  const hp = !platform.perangkat ? hpAbsen(token) : null;
  const alasan = !s.absen_pin_aktif ? "Absen PIN belum diaktifkan admin"
    : platform.perangkat ? (
        !cabangAktif() ? "Perangkat ini belum tersambung ke server pusat"
        : !s.cabang_absen ? "Perangkat ini belum diizinkan untuk absen (admin: Pengaturan → Absensi → Perangkat yang boleh dipakai absen)" : "")
    : !hp ? "HP ini belum didaftarkan untuk absen (admin: masuk di HP ini → Pengaturan → Absensi → Jadikan HP ini tempat absen)"
    : !hp.absen ? "HP ini belum diizinkan untuk absen (admin: Pengaturan → Absensi → Perangkat yang boleh dipakai absen)" : "";
  const titik = titikAbsen(s), lokasiAda = titik.length > 0;
  const alasan2 = alasan || (!lokasiAda ? "Lokasi toko untuk absen belum diatur" : "");
  return { aktif: !!s.absen_pin_aktif, boleh: !alasan2, alasan: alasan2, hp: hp ? hp.nama : null, hpId: hp ? hp.id : null,
    radius: Number(s.absen_radius) || 100, lat: titik[0] ? titik[0].lat : NaN, lng: titik[0] ? titik[0].lng : NaN, titik };
}
route("GET", "/api/absen/kiosk", false, ({ query }) => {
  const { hpId, ...st } = statusKiosk(query.alat);
  return st.boleh ? { ...st, staf: all("SELECT id, nama FROM users WHERE aktif = 1 AND pass_hash IS NOT NULL ORDER BY nama"), wajah: dataWajah() } : st;
});
/** Admin mendaftarkan HP yang sedang dipakai (browser) sebagai tempat absen. Langsung diizinkan absen. */
route("POST", "/api/absen/daftar-hp", "admin", ({ body, user }) => {
  const nama = teks(body.nama, { wajib: true, max: 40, nama: "Nama HP" });
  const dipakai = new Set(all("SELECT kode FROM perangkat").map(r => r.kode));
  let i = 1; while (dipakai.has("W" + i)) i++;
  const token = platform.token();
  run("INSERT INTO perangkat(kode, nama, token_hash, admin_id, absen) VALUES (?,?,?,?,1)", ["W" + i, nama, platform.sha256(token), user.id]);
  return { token, kode: "W" + i, nama };
}, { pusatSaja: true });
const FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/* ---- Wajah karyawan (untuk mencocokkan selfie absen; dihitung & dicocokkan di HP, server hanya menyimpan angka ciri wajah) ---- */
const dataWajah = () => { const w = getSettings().wajah; return w && typeof w === "object" && !Array.isArray(w) ? w : {}; };
const BATAS_WAJAH = 0.5;
/** Jarak ciri wajah (128 angka) ke wajah terdaftar karyawan; null bila tidak bisa dicek. */
function jarakWajahTerdaftar(userId, ciri){
  const d = (dataWajah()[userId] || {}).d;
  if (!Array.isArray(d) || !d.length || !Array.isArray(ciri) || ciri.length !== 128 || !ciri.every(n => typeof n === "number" && isFinite(n))) return null;
  return Math.min(...d.map(v => Math.sqrt(v.reduce((s, x, i) => s + (x - ciri[i]) ** 2, 0))));
}
/** Masuk aplikasi dengan wajah — hanya di perangkat yang diizinkan absen, hanya akun karyawan (admin tetap pakai password). */
route("POST", "/api/login-wajah", false, ({ body, ctx }) => {
  const st = statusKiosk(body.alat);
  if (!st.boleh) throw new HttpError(403, "Masuk dengan wajah hanya bisa di perangkat yang diizinkan absen");
  const kunci = (ctx.ip || "") + "|login-wajah";
  cekBatasLogin(kunci);
  const hasil = Object.keys(dataWajah()).map(id => ({ id: +id, d: jarakWajahTerdaftar(+id, body.ciri) })).filter(x => x.d != null).sort((a, b) => a.d - b.d);
  const [satu, dua] = hasil;
  if (!satu || satu.d >= BATAS_WAJAH - 0.05 || (dua && dua.d - satu.d < 0.08)) { catatGagal(kunci); throw new HttpError(401, "Wajah tidak dikenali — masuk dengan nama & PIN"); }
  const u = one("SELECT id, nama, peran, aktif FROM users WHERE id = ?", [satu.id]);
  if (!u || !u.aktif) throw new HttpError(401, "Akun tidak aktif");
  if (u.peran === "admin") {
    // Admin: syarat wajah lebih ketat & harus dikonfirmasi (Ya / Tidak) di layar sebelum masuk.
    if (satu.d >= BATAS_WAJAH - 0.1) { catatGagal(kunci); throw new HttpError(401, "Wajah admin kurang jelas — dekatkan ke kamera di tempat terang, atau masuk dengan password"); }
    const t = platform.token();
    konfirmasiAdmin.set(t, { id: u.id, sampai: Date.now() + 60_000, tempat: st.hp || getSettings().cabang_nama || "perangkat kasir" });
    for (const [k, v] of konfirmasiAdmin) if (v.sampai < Date.now()) konfirmasiAdmin.delete(k);
    resetGagal(kunci);
    return { konfirmasi: t, nama: u.nama, admin: true };
  }
  resetGagal(kunci);
  buatSesi(ctx, u.id);
  return { ok: true, nama: u.nama };
}, { batas: 20_000 });
const konfirmasiAdmin = new Map();
/** Admin menekan "Ya, masuk" setelah wajahnya dikenali (berlaku 1 menit). */
route("POST", "/api/login-wajah/konfirmasi", false, ({ body, ctx }) => {
  const k = konfirmasiAdmin.get(String(body.konfirmasi || "")); konfirmasiAdmin.delete(String(body.konfirmasi || ""));
  if (!k || k.sampai < Date.now()) throw new HttpError(401, "Konfirmasi kedaluwarsa — pindai wajah lagi");
  const u = one("SELECT id, nama, aktif FROM users WHERE id = ? AND peran = 'admin'", [k.id]); if (!u || !u.aktif) throw new HttpError(401, "Akun tidak aktif");
  buatSesi(ctx, u.id);
  antreNotif(`🔐 Admin ${u.nama} masuk dengan wajah`, `Di ${k.tempat} · ${sekarang().tgl} ${sekarang().jam}. Bukan Anda? Ganti password di Pengaturan → Pengguna.`, "/#atur");
  return { ok: true, nama: u.nama };
});
const wajahAbsen = b => { const d = Number(b.wajah); return isFinite(d) && d >= 0 && d < 5 ? { wajah: Math.round(d * 1000) / 1000, wajah_ok: b.wajah_ok ? 1 : 0 } : { wajah: null, wajah_ok: null }; };
route("GET", "/api/absen/wajah", "admin", () => Object.fromEntries(Object.entries(dataWajah()).map(([id, x]) => [id, { jumlah: (x.d || []).length, tgl: x.t || "" }])));
route("PUT", "/api/absen/wajah", "admin", ({ body }) => {
  const u = one("SELECT id FROM users WHERE id = ? AND aktif = 1", [+body.user_id]); if (!u) throw bad("Pilih karyawan");
  const d = Array.isArray(body.data) ? body.data.slice(0, 8) : [];
  if (!d.length || !d.every(v => Array.isArray(v) && v.length === 128 && v.every(n => typeof n === "number" && isFinite(n) && Math.abs(n) < 5))) throw bad("Data wajah tidak valid — ambil foto wajah lagi");
  const w = { ...dataWajah(), [u.id]: { d: d.map(v => v.map(n => Math.round(n * 10000) / 10000)), t: sekarang().tgl } };
  setSetting("wajah", w); return { ok: true, jumlah: d.length };
}, { pusatSaja: true });
/** Daftar wajah otomatis dari absen ber-PIN: wajah belum terdaftar → selfie ini jadi wajah awal; terdaftar < 5 foto & cocok → ditambah agar makin akurat. */
const ciriValid = c => Array.isArray(c) && c.length === 128 && c.every(n => typeof n === "number" && isFinite(n) && Math.abs(n) < 5);
function daftarWajahOtomatis(u, ciri, tgl, jam){
  if (!ciriValid(ciri)) return false;
  const W = dataWajah(), lama = (W[u.id] || {}).d || [];
  if (lama.length >= 5) return false;
  if (lama.length) { const d = jarakWajahTerdaftar(u.id, ciri); if (d == null || d >= BATAS_WAJAH) return false; }
  setSetting("wajah", { ...W, [u.id]: { d: [...lama, ciri.map(n => Math.round(n * 10000) / 10000)], t: (W[u.id] || {}).t || tgl, oto: 1 } });
  if (!lama.length) antreNotif(`😊 Wajah ${u.nama} terdaftar otomatis`, `Dari selfie absen ${tgl} ${String(jam).slice(0, 5)} (pakai PIN). Pastikan fotonya benar ${u.nama} — bila salah, hapus di Pengaturan → Absensi → Wajah karyawan.`, `/#absen?tgl=${tgl}&u=${u.id}`);
  return true;
}
const antreCiri = new Map(); // absen di perangkat cabang: ciri wajah dibawa ke server pusat bersama absennya
/** Foto selfie absen terbaru seorang karyawan (untuk mendaftarkan wajah dari absen sebelumnya). */
route("GET", "/api/absen/foto-terakhir", "admin", ({ query }) => all(
  "SELECT id, tgl, jam, foto FROM absen WHERE user_id = ? AND foto IS NOT NULL AND dihapus IS NULL AND sumber = 'pin' ORDER BY tgl DESC, jam DESC LIMIT ?",
  [+query.user_id, Math.min(12, Math.max(1, +query.n || 8))]).map(a => ({ ...a, jam: a.jam.slice(0, 5) })), { pusatSaja: true });
route("DELETE", "/api/absen/wajah", "admin", ({ body }) => { const w = { ...dataWajah() }; delete w[+body.user_id]; setSetting("wajah", w); return { ok: true }; }, { pusatSaja: true });
route("POST", "/api/absen/pin", false, ({ body, ctx }) => {
  const st = statusKiosk(body.alat);
  if (!st.boleh) throw new HttpError(403, st.alasan);
  const u = one("SELECT id, nama, nama_key, pass_hash, aktif FROM users WHERE id = ?", [+body.user_id]);
  if (!u || !u.aktif) throw bad("Pilih nama karyawan");
  const kunci = (ctx.ip || "") + "|absen|" + u.nama_key;
  cekBatasLogin(kunci);
  // Tanpa PIN bila wajah dikenali: ciri wajah dari HP dicocokkan di sini dengan wajah terdaftar karyawan itu.
  const dWajah = jarakWajahTerdaftar(u.id, body.ciri);
  if (String(body.pin ?? "") === "") {
    if (dWajah == null) throw new HttpError(401, dataWajah()[u.id] ? "Wajah belum terbaca — ulangi foto, atau ketik PIN" : "Wajah belum didaftarkan admin — ketik PIN");
    if (dWajah >= BATAS_WAJAH) { catatGagal(kunci); throw new HttpError(401, "Wajah tidak dikenali — ulangi foto, atau ketik PIN"); }
  } else if (!cekPassword(String(body.pin), u.pass_hash)) { catatGagal(kunci); throw new HttpError(401, "PIN salah"); }
  resetGagal(kunci);
  if (dWajah != null) Object.assign(body, { wajah: dWajah, wajah_ok: dWajah < BATAS_WAJAH });
  const foto = String(body.foto || "");
  if (!FOTO.test(foto) || foto.length < 2000) throw bad("Ambil foto selfie dulu");
  if (foto.length > 400_000) throw bad("Foto terlalu besar");
  const jarak = cekLokasi(body.lat, body.lng, body.akurasi);
  const jenis = body.jenis === "pulang" ? "pulang" : "masuk";
  const w = sekarang(), uid = platform.token();
  const wj = wajahAbsen(body);
  const id = Number(run(`INSERT INTO absen(tgl, jam, user_id, sumber, jenis, foto, lat, lng, jarak, uid, mesin, oleh, wajah, wajah_ok) VALUES (?,?,?, 'pin', ?,?,?,?,?,?,?,?,?,?)`,
    [w.tgl, w.jam.slice(0, 5) + ":00", u.id, jenis, foto, +body.lat, +body.lng, jarak, uid, st.hp || getSettings().cabang_nama || "", u.nama, wj.wajah, wj.wajah_ok]).lastInsertRowid);
  if (st.hpId) run("UPDATE perangkat SET terakhir = datetime('now') WHERE id = ?", [st.hpId]);
  notifAbsen({ userId: u.id, tgl: w.tgl, jam: w.jam, jenis, tempat: st.hp || getSettings().cabang_nama || "" });
  if (wj.wajah_ok === 0) antreNotif(`⚠️ Wajah tidak cocok · ${u.nama}`, `Absen ${jenis} ${w.jam.slice(0, 5)} — cek foto selfie-nya di Rekap Absen`, `/#absen?tgl=${w.tgl}&u=${u.id}`);
  let wajahBaru = false;
  if (String(body.pin ?? "") !== "" && ciriValid(body.ciri) && (((dataWajah()[u.id] || {}).d || []).length < 5)) {
    if (cabangAktif()) { antreCiri.set(uid, body.ciri); wajahBaru = !dataWajah()[u.id]; }
    else wajahBaru = daftarWajahOtomatis(u, body.ciri, w.tgl, w.jam) && ((dataWajah()[u.id] || {}).d || []).length === 1;
  }
  return { ok: true, id, uid, nama: u.nama, jenis, jam: w.jam.slice(0, 5), jarak, wajahBaru };
}, { batas: 500_000, cabang: ({ hasil: h }) => {
  const a = one("SELECT a.tgl, a.jam, a.jenis, a.foto, a.lat, a.lng, a.wajah, a.wajah_ok, u.nama_key FROM absen a JOIN users u ON u.id = a.user_id WHERE a.uid = ?", [h.uid]);
  const ciri = antreCiri.get(h.uid); antreCiri.delete(h.uid);
  return { aksi: "absen", data: { uid: h.uid, nama_key: a.nama_key, tgl: a.tgl, jam: a.jam.slice(0, 5), jenis: a.jenis, foto: a.foto, lat: a.lat, lng: a.lng, wajah: a.wajah, wajah_ok: a.wajah_ok, ciri } };
} });

/** Absen dari perangkat cabang diterima server (dipanggil dari /api/cabang/kirim). */
export function terimaAbsen(x, alat){
  if (!alat.absen) throw bad("Perangkat ini tidak diizinkan untuk absen");
  const u = one("SELECT id, nama FROM users WHERE nama_key = ?", [String(x.nama_key || "")]);
  if (!u) throw bad("Karyawan tidak dikenal di server");
  const jarak = cekLokasi(x.lat, x.lng, 0);
  const wj = x.wajah == null ? { wajah: null, wajah_ok: null } : wajahAbsen(x);
  const r = run(`INSERT OR IGNORE INTO absen(tgl, jam, user_id, sumber, jenis, foto, lat, lng, jarak, uid, mesin, oleh, wajah, wajah_ok) VALUES (?,?,?, 'pin', ?,?,?,?,?,?,?,?,?,?)`,
    [tanggal(x.tgl), String(x.jam || "00:00").slice(0, 5) + ":00", u.id, x.jenis === "pulang" ? "pulang" : "masuk", String(x.foto || "").slice(0, 400_000), +x.lat, +x.lng, jarak, String(x.uid), alat.nama, u.nama, wj.wajah, wj.wajah_ok]);
  if (Number(r.changes || 0) > 0 && wj.wajah_ok === 0) antreNotif(`⚠️ Wajah tidak cocok · ${u.nama}`, `Absen ${x.jenis === "pulang" ? "pulang" : "masuk"} ${String(x.jam || "").slice(0, 5)} di ${alat.nama} — cek foto selfie-nya`, `/#absen?tgl=${tanggal(x.tgl)}&u=${u.id}`);
  if (Number(r.changes || 0) > 0 && x.ciri) daftarWajahOtomatis(u, x.ciri, tanggal(x.tgl), String(x.jam || "00:00"));
  if (Number(r.changes || 0) > 0) notifAbsen({ userId: u.id, tgl: tanggal(x.tgl), jam: String(x.jam || "00:00"), jenis: x.jenis === "pulang" ? "pulang" : "masuk", tempat: alat.nama });
  return { ok: true };
}

/** Foto selfie satu absen (admin). Di perangkat cabang diambil dari server pusat. */
export const fotoAbsen = id => { const a = one("SELECT foto FROM absen WHERE id = ?", [+id]); if (!a || !a.foto) throw notFound("Foto tidak ada"); return { foto: a.foto }; };
route("GET", "/api/absen/:id/foto", "admin", async ({ params }) => cabangAktif() ? mintaPusat("/api/cabang/absen-foto", { id: +params.id }) : fotoAbsen(params.id));

/** Admin di perangkat kasir: jadikan lokasi perangkat ini sebagai lokasi toko (disimpan di server pusat). */
route("POST", "/api/absen/lokasi-toko", "admin", async ({ body }) => {
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!isFinite(lat) || !isFinite(lng)) throw bad("Lokasi tidak terbaca");
  if (cabangAktif()) return mintaPusat("/api/cabang/absen-lokasi", { lat, lng });
  setSetting("absen_lat", String(lat)); setSetting("absen_lng", String(lng));
  return { ok: true };
});

const JAM = /^([01]\d|2[0-3]):[0-5]\d$/;
const jamValid = (v, nama) => { const j = String(v || "").trim(); if (!JAM.test(j)) throw bad(`${nama} harus berformat JJ:MM, contoh 08:00`); return j; };

/** Satu scan dari mesin. Mengembalikan true bila tersimpan (scan yang sama dua kali tidak dobel). */
function simpanScan(x, mesin){
  const pin = String(x && (x.pin ?? x.PIN ?? x.user_id ?? "")).trim().slice(0, 30);
  const m = String(x && (x.scan ?? x.scan_date ?? x.waktu ?? "")).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
  if (!pin || !m) return false;
  const r = run(`INSERT OR IGNORE INTO absen(tgl, jam, pin, sumber, mesin, verify, status_scan) VALUES (?,?,?, 'mesin', ?,?,?)`,
    [m[1], m[2] + (m[3] || ":00"), pin, mesin, x.verify == null ? null : String(x.verify).slice(0, 10), x.status_scan == null ? null : String(x.status_scan).slice(0, 10)]);
  const baru = Number(r.changes || 0) > 0;
  if (baru) { const u = one("SELECT id FROM users WHERE pin_absen = ?", [pin]); if (u) notifAbsen({ userId: u.id, tgl: m[1], jam: m[2], jenis: null, tempat: "mesin sidik jari" }); }
  return baru;
}

/* Penerima data dari mesin. Publik (mesin tidak bisa login), dilindungi kunci rahasia di alamatnya. */
route("POST", "/api/absen/mesin/:kunci", false, ({ params, body }) => {
  const s = getSettings();
  if (!s.absen_aktif || !s.absen_token || params.kunci !== s.absen_token) throw new HttpError(403, "Absensi belum diaktifkan atau alamat salah");
  const pesan = Array.isArray(body) ? body : [body];
  let baru = 0, jenis = "";
  tx(() => {
    for (const p of pesan) {
      if (!p || typeof p !== "object") continue;
      jenis = String(p.type || "").slice(0, 30);
      const mesin = String(p.cloud_id || p.sn || "").slice(0, 60);
      if (s.absen_mesin && mesin && mesin !== s.absen_mesin) continue; // mesin lain (bukan milik toko ini)
      if (jenis && jenis !== "attlog") continue; // pesan lain dari layanan mesin (info, uji coba)
      const daftar = Array.isArray(p.data) ? p.data : [p.data || p];
      for (const x of daftar) if (simpanScan(x, mesin)) baru++;
    }
    setSetting("absen_terakhir", JSON.stringify({ waktu: new Date().toISOString(), jenis: jenis || "attlog", baru }));
  });
  return { ok: true, baru };
}, { tanpaRG: true, batas: 200_000 });

/* ================= Shift kerja & lembur =================
   Jam operasional toko 09.00–21.00. Shift diatur admin (bawaan: Shift 1 09.00–17.00, Shift 2 12.00–21.00).
   Lembur = datang lebih awal dari jam masuk shift + pulang lebih lambat dari jam pulang shift,
   dibulatkan ke bawah per blok (bawaan 30 menit), dibayar per jam sesuai tarif yang bisa diubah. */
const menit = j => { const [h, m] = String(j || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
/** Kabari HP admin: karyawan absen masuk / pulang, lengkap dengan shift & terlambat / lembur. */
function notifAbsen({ userId, tgl, jam, jenis, tempat }){
  try {
    const u = one("SELECT nama, shift, libur FROM users WHERE id = ?", [userId]); if (!u) return;
    if (tgl !== sekarang().tgl) return; // absen lama yang baru terkirim tidak perlu dikabarkan
    const j = String(jam).slice(0, 5), nm = String(u.nama).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    const masukHariIni = one("SELECT MIN(jam) j FROM absen WHERE user_id = ? AND tgl = ? AND (jenis = 'masuk' OR jenis IS NULL)", [userId, tgl])?.j;
    const sh = shiftHari(tgl, daftarShift(), u.shift, jenis === "masuk" ? j : (masukHariIni || j).slice(0, 5));
    let ket = "";
    if (jenis === "masuk") { const d = menit(j) - menit(sh.masuk); ket = d > 0 ? `terlambat ${d} menit` : d < 0 ? `datang ${-d} menit lebih awal` : "tepat waktu"; }
    else if (jenis === "pulang") { const d = menit(j) - menit(sh.pulang); ket = d > 0 ? `lewat ${d} menit dari jam pulang` : d < 0 ? `pulang ${-d} menit lebih awal` : "tepat jam pulang"; }
    const judul = jenis === "masuk" ? `☀️ ${nm} absen masuk · ${j}` : jenis === "pulang" ? `🌙 ${nm} absen pulang · ${j}` : `🖐️ ${nm} scan absen · ${j}`;
    antreNotif(judul, [`${sh.nama} (${sh.masuk}–${sh.pulang})`, ket, liburPada(u, tgl) ? `⚠️ hari libur ${nm}` : "", tempat].filter(Boolean).join(" · "), `/#absen?tgl=${tgl}&u=${userId}`); // ketuk → Rekap Absen tanggal itu
  } catch { /* notifikasi tidak boleh menggagalkan absen */ }
}
export const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const hariKe = tgl => new Date(String(tgl) + "T00:00:00Z").getUTCDay();
/** Jam toko khusus hari itu ({ buka, tutup }) atau null. */
export function jamKhusus(tgl, s = getSettings()){
  const x = s.jam_hari && s.jam_hari[String(hariKe(tgl))];
  return x && JAM.test(x.buka) && JAM.test(x.tutup) && menit(x.tutup) > menit(x.buka) ? x : null;
}
/** Shift karyawan pada tanggal itu: di hari berjam khusus (mis. Minggu 09–17, Sabtu 12–21) semua memakai jam toko hari itu. */
export function shiftHari(tgl, shifts, pilihan, masuk, s = getSettings()){
  const k = jamKhusus(tgl, s);
  return k ? { nama: NAMA_HARI[hariKe(tgl)], masuk: k.buka, pulang: k.tutup, no: 0 } : pilihShift(shifts, pilihan, masuk);
}
const liburPada = (u, tgl) => u.libur != null && u.libur !== "" && Number(u.libur) === hariKe(tgl);
export function daftarShift(s = getSettings()){
  const a = Array.isArray(s.shifts) ? s.shifts.filter(x => x && JAM.test(x.masuk) && JAM.test(x.pulang) && menit(x.pulang) > menit(x.masuk)) : [];
  return a.length ? a.map((x, i) => ({ nama: String(x.nama || `Shift ${i + 1}`), masuk: x.masuk, pulang: x.pulang }))
    : [{ nama: "Normal", masuk: s.absen_jam_masuk || "08:00", pulang: s.absen_jam_pulang || "17:00" }];
}
/** Shift karyawan pada hari itu: shift tetap karyawan, atau (otomatis) shift yang jam masuknya paling dekat dengan jam datang. */
export function pilihShift(shifts, pilihan, masuk){
  const i = Number(pilihan);
  if (i >= 1 && i <= shifts.length) return { ...shifts[i - 1], no: i };
  let k = 0;
  if (masuk) shifts.forEach((x, j) => { if (Math.abs(menit(x.masuk) - menit(masuk)) < Math.abs(menit(shifts[k].masuk) - menit(masuk))) k = j; });
  return { ...shifts[k], no: k + 1 };
}
/** Menit lembur satu hari (sudah dibulatkan). */
export function hitungLembur(shift, masuk, pulang, bulat){
  const awal = masuk ? Math.max(0, menit(shift.masuk) - menit(masuk)) : 0;
  const akhir = pulang ? Math.max(0, menit(pulang) - menit(shift.pulang)) : 0;
  const b = Math.max(1, Number(bulat) || 1);
  return { awal, akhir, menit: Math.floor((awal + akhir) / b) * b };
}
export const nilaiLembur = (mnt, perJam) => Math.round(mnt / 60 * (Number(perJam) || 0));

/** Rekap absensi. Jam masuk = absen "masuk" pertama (atau scan pertama), jam pulang = absen "pulang" terakhir
 *  (atau scan terakhir bila lebih dari satu scan). Terlambat, pulang cepat, dan lembur dihitung dari shift karyawan. */
export function rekapAbsen(dari, sampai){
  const s = getSettings(), shifts = daftarShift(s);
  const users = all("SELECT id, nama, nama_key, peran, aktif, pin_absen, shift, libur FROM users ORDER BY nama");
  const perPin = new Map(users.filter(u => u.pin_absen).map(u => [u.pin_absen, u]));
  const perId = new Map(users.map(u => [u.id, u]));
  const scan = all("SELECT id, tgl, jam, pin, user_id, sumber, ket, oleh, jenis, jarak, mesin, wajah, wajah_ok, foto IS NOT NULL ada_foto FROM absen WHERE dihapus IS NULL AND tgl BETWEEN ? AND ? ORDER BY tgl, jam", [dari, sampai]);
  const hari = new Map(), takDikenal = new Map();
  for (const a of scan) {
    const u = a.user_id ? perId.get(a.user_id) : perPin.get(a.pin);
    if (!u) { const t = takDikenal.get(a.pin) || { pin: a.pin, jumlah: 0, terakhir: "" }; t.jumlah++; t.terakhir = `${a.tgl} ${a.jam}`; takDikenal.set(a.pin, t); continue; }
    const k = `${a.tgl}|${u.id}`;
    if (!hari.has(k)) hari.set(k, { tgl: a.tgl, user_id: u.id, nama: u.nama, nama_key: u.nama_key, pilihanShift: u.shift, hari_libur: liburPada(u, a.tgl), scan: [] });
    hari.get(k).scan.push({ id: a.id, jam: a.jam.slice(0, 5), sumber: a.sumber, ket: a.ket, oleh: a.oleh, jenis: a.jenis, jarak: a.jarak, perangkat: a.sumber === "pin" ? a.mesin : "", foto: !!a.ada_foto, wajah: a.wajah, wajah_ok: a.wajah_ok });
  }
  const harian = [...hari.values()].map(({ pilihanShift, ...h }) => {
    const sc = h.scan, akhir = sc[sc.length - 1];
    const m = sc.find(x => x.jenis === "masuk") || sc.find(x => x.jenis !== "pulang");
    let p = [...sc].reverse().find(x => x.jenis === "pulang") || (sc.length > 1 && akhir !== m && akhir.jenis !== "masuk" ? akhir : null);
    if (p && m && p.jam < m.jam) p = null;
    const masuk = m ? m.jam : "", pulang = p ? p.jam : "";
    const shift = shiftHari(h.tgl, shifts, pilihanShift, masuk, s);
    const l = hitungLembur(shift, masuk, pulang, s.lembur_bulat);
    return { ...h, masuk, pulang, shift: shift.nama, shift_masuk: shift.masuk, shift_pulang: shift.pulang,
      terlambat: !!masuk && masuk > shift.masuk, pulangCepat: !!pulang && pulang < shift.pulang,
      lembur: l.menit, lembur_awal: l.awal, lembur_akhir: l.akhir };
  }).sort((a, b) => b.tgl.localeCompare(a.tgl) || a.nama.localeCompare(b.nama));
  const ringkas = new Map();
  for (const h of harian) {
    const r = ringkas.get(h.user_id) || { user_id: h.user_id, nama: h.nama, nama_key: h.nama_key, hadir: 0, terlambat: 0, tanpaPulang: 0, lembur: 0, lembur_rp: 0, masukLibur: 0 };
    r.hadir++; if (h.hari_libur) r.masukLibur++; if (h.terlambat) r.terlambat++; if (!h.pulang) r.tanpaPulang++; r.lembur += h.lembur;
    ringkas.set(h.user_id, r);
  }
  // Keterangan karyawan (telat / izin / sakit / absen error)
  const keterangan = all("SELECT k.id, k.tgl, k.user_id, u.nama, k.jenis, k.arah, k.jam, k.alasan, k.status, k.oleh, k.putus_oleh FROM absen_ket k JOIN users u ON u.id = k.user_id WHERE k.tgl BETWEEN ? AND ? ORDER BY k.tgl DESC, k.id DESC", [dari, sampai]);
  for (const k of keterangan) {
    const h = harian.find(x => x.tgl === k.tgl && x.user_id === k.user_id); if (h) (h.keterangan = h.keterangan || []).push(k);
    if (k.status === "diterima" && (k.jenis === "izin" || k.jenis === "sakit")) {
      const u = perId.get(k.user_id); if (!u) continue;
      const r = ringkas.get(k.user_id) || { user_id: k.user_id, nama: u.nama, nama_key: u.nama_key, hadir: 0, terlambat: 0, tanpaPulang: 0, lembur: 0, lembur_rp: 0, masukLibur: 0 };
      r[k.jenis] = (r[k.jenis] || 0) + 1; ringkas.set(k.user_id, r);
    }
  }
  for (const r of ringkas.values()) r.lembur_rp = nilaiLembur(r.lembur, s.lembur_per_jam);
  // Karyawan yang libur pada tanggal itu (untuk tampilan satu hari) & jam toko khusus hari itu
  const satuHari = dari === sampai;
  const libur = satuHari ? users.filter(u => u.aktif && liburPada(u, dari)).map(u => ({ user_id: u.id, nama: u.nama })) : [];
  return {
    dari, sampai, aktif: !!(s.absen_aktif || s.absen_pin_aktif), shifts, jam_buka: s.jam_buka, jam_tutup: s.jam_tutup,
    libur, jam_hari: s.jam_hari || {}, jam_khusus: satuHari ? jamKhusus(dari, s) : null, hari: satuHari ? NAMA_HARI[hariKe(dari)] : null,
    lembur_per_jam: Number(s.lembur_per_jam) || 0, lembur_bulat: Number(s.lembur_bulat) || 0,
    harian, ringkas: [...ringkas.values()].sort((a, b) => a.nama.localeCompare(b.nama)), takDikenal: [...takDikenal.values()], keterangan,
  };
}

/** Lembur per karyawan dalam satu periode (untuk rekap insentif). */
export function lemburPeriode(dari, sampai){
  return rekapAbsen(dari, sampai).ringkas.filter(r => r.lembur > 0).map(r => ({ nama_key: r.nama_key, user_id: r.user_id, menit: r.lembur, rp: r.lembur_rp }));
}

route("GET", "/api/absen", "admin", async ({ query }) => {
  const t = sekarang().tgl;
  const dari = query.dari ? tanggal(query.dari) : t, sampai = query.sampai ? tanggal(query.sampai) : dari;
  if (sampai < dari) throw bad("Tanggal akhir sebelum tanggal awal");
  // Perangkat cabang: data absensi ada di server pusat (mesin mengirim ke sana).
  if (cabangAktif()) return mintaPusat("/api/cabang/absen", { dari, sampai });
  return rekapAbsen(dari, sampai);
});

/* Pengaturan absensi & PIN mesin tiap karyawan (di server pusat). */
route("GET", "/api/absen/pengaturan", "admin", () => {
  const s = getSettings();
  let terakhir = null; try { terakhir = s.absen_terakhir ? JSON.parse(s.absen_terakhir) : null; } catch { /* abaikan */ }
  return {
    aktif: !!s.absen_aktif, alamat: s.absen_token ? `/api/absen/mesin/${s.absen_token}` : "", mesin: s.absen_mesin,
    shifts: daftarShift(s), terakhir,
    pin_aktif: !!s.absen_pin_aktif, lat: s.absen_lat, lng: s.absen_lng, radius: Number(s.absen_radius) || 100, lokasi_lain: Array.isArray(s.absen_lokasi_lain) ? s.absen_lokasi_lain : [],
    karyawan: all("SELECT id, nama, peran, aktif, pin_absen, shift FROM users ORDER BY aktif DESC, peran DESC, nama"),
  };
});

route("PUT", "/api/absen/pengaturan", "admin", ({ body }) => tx(() => {
  const s = getSettings();
  if (body.aktif != null) setSetting("absen_aktif", !!body.aktif);
  if ((body.aktif && !s.absen_token) || body.kunciBaru) setSetting("absen_token", platform.token());
  if (body.mesin != null) setSetting("absen_mesin", teks(body.mesin, { max: 60, nama: "Cloud ID mesin" }));
  if (body.jam_masuk != null) setSetting("absen_jam_masuk", jamValid(body.jam_masuk, "Jam masuk"));
  if (body.jam_pulang != null) setSetting("absen_jam_pulang", jamValid(body.jam_pulang, "Jam pulang"));
  if (body.pin_aktif != null) setSetting("absen_pin_aktif", !!body.pin_aktif);
  if (body.radius != null) { const r = Number(body.radius); if (!(r >= 20 && r <= 2000)) throw bad("Radius 20–2000 meter"); setSetting("absen_radius", Math.round(r)); }
  if (body.lat != null || body.lng != null) {
    const kosong = String(body.lat ?? "").trim() === "" && String(body.lng ?? "").trim() === "";
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!kosong && !(isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw bad("Koordinat toko tidak valid. Contoh: -6.3274, 108.3247");
    setSetting("absen_lat", kosong ? "" : String(lat)); setSetting("absen_lng", kosong ? "" : String(lng));
  }
  if (Array.isArray(body.lokasi_lain)) setSetting("absen_lokasi_lain", body.lokasi_lain.slice(0, 5).map((x, i) => {
    const lat = Number(x && x.lat), lng = Number(x && x.lng);
    if (!(isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw bad(`Koordinat lokasi ke-${i + 2} tidak valid. Contoh: -6.3274, 108.3247`);
    return { nama: teks(x.nama, { max: 40, nama: "Nama lokasi" }) || `Lokasi ${i + 2}`, lat, lng };
  }));
  if (Array.isArray(body.pin)) {
    const dipakai = new Map();
    for (const x of body.pin) {
      const pin = teks(x && x.pin, { max: 30, nama: "PIN mesin" });
      if (pin && !/^[0-9A-Za-z]+$/.test(pin)) throw bad(`PIN mesin "${pin}" hanya boleh angka/huruf`);
      if (pin && dipakai.has(pin)) throw bad(`PIN mesin ${pin} dipakai dua orang`);
      if (pin) dipakai.set(pin, +x.user_id);
    }
    run("UPDATE users SET pin_absen = NULL");
    for (const [pin, id] of dipakai) {
      if (!one("SELECT 1 x FROM users WHERE id = ?", [id])) throw notFound("Karyawan tidak ditemukan");
      run("UPDATE users SET pin_absen = ? WHERE id = ?", [pin, id]);
    }
  }
  return { ok: true };
}));

/* Jam kerja, shift, lembur & tarif insentif lain (admin, di server pusat). */
route("GET", "/api/jam-kerja", "admin", () => {
  const s = getSettings();
  return {
    jam_buka: s.jam_buka, jam_tutup: s.jam_tutup, shifts: daftarShift(s),
    lembur_per_jam: Number(s.lembur_per_jam) || 0, lembur_bulat: Number(s.lembur_bulat) || 0,
    ins_kurir: Number(s.ins_kurir) || 0, ins_lapangan: Number(s.ins_lapangan) || 0, ins_konten: Number(s.ins_konten) || 0, ins_dekorasi: Number(s.ins_dekorasi) || 0,
    jam_hari: s.jam_hari || {},
    karyawan: all("SELECT id, nama, peran, aktif, shift, libur FROM users ORDER BY aktif DESC, peran DESC, nama"),
  };
});
route("PUT", "/api/jam-kerja", "admin", ({ body }) => tx(() => {
  if (body.jam_buka != null) setSetting("jam_buka", jamValid(body.jam_buka, "Jam buka"));
  if (body.jam_tutup != null) setSetting("jam_tutup", jamValid(body.jam_tutup, "Jam tutup"));
  if (body.shifts != null) {
    if (!Array.isArray(body.shifts) || !body.shifts.length || body.shifts.length > 6) throw bad("Isi 1–6 shift");
    setSetting("shifts", body.shifts.map((x, i) => {
      const nama = teks(x && x.nama, { max: 30, nama: "Nama shift" }) || `Shift ${i + 1}`;
      const masuk = jamValid(x && x.masuk, `Jam masuk ${nama}`), pulang = jamValid(x && x.pulang, `Jam pulang ${nama}`);
      if (pulang <= masuk) throw bad(`Jam pulang ${nama} harus setelah jam masuk`);
      return { nama, masuk, pulang };
    }));
  }
  const rp = (k, nama) => { if (body[k] != null) { const n = Number(body[k]); if (!(n >= 0 && n <= 1e8)) throw bad(`${nama} tidak valid`); setSetting(k, Math.round(n)); } };
  rp("lembur_per_jam", "Upah lembur per jam"); rp("ins_kurir", "Insentif kurir"); rp("ins_lapangan", "Insentif kerja lapangan"); rp("ins_konten", "Insentif buat konten"); rp("ins_dekorasi", "Insentif dekorasi");
  if (body.lembur_bulat != null) { const b = Number(body.lembur_bulat); if (![1, 15, 30, 60].includes(b)) throw bad("Pembulatan lembur: 1, 15, 30, atau 60 menit"); setSetting("lembur_bulat", b); }
  if (body.jam_hari != null) {
    if (typeof body.jam_hari !== "object" || Array.isArray(body.jam_hari)) throw bad("Jam per hari tidak valid");
    const jh = {};
    for (const [h, x] of Object.entries(body.jam_hari)) {
      if (!/^[0-6]$/.test(h) || !x) continue;
      const buka = jamValid(x.buka, `Jam buka ${NAMA_HARI[+h]}`), tutup = jamValid(x.tutup, `Jam tutup ${NAMA_HARI[+h]}`);
      if (tutup <= buka) throw bad(`Jam tutup ${NAMA_HARI[+h]} harus setelah jam buka`);
      jh[h] = { buka, tutup };
    }
    setSetting("jam_hari", jh);
  }
  if (Array.isArray(body.libur_karyawan)) {
    for (const x of body.libur_karyawan) {
      const v = String((x && x.libur) ?? "");
      run("UPDATE users SET libur = ? WHERE id = ?", [/^[0-6]$/.test(v) ? v : null, +x.user_id]);
    }
  }
  if (Array.isArray(body.shift_karyawan)) {
    const n = daftarShift().length;
    for (const x of body.shift_karyawan) {
      const v = String(x && x.shift || "");
      run("UPDATE users SET shift = ? WHERE id = ?", [Number(v) >= 1 && Number(v) <= n ? String(Number(v)) : "", +x.user_id]);
    }
  }
  return { ok: true };
}));

/* ================= Keterangan absen: telat, izin, sakit, absen error =================
   Diajukan karyawan (atau admin atas nama karyawan), lalu diterima / ditolak admin.
   "Absen error" yang diterima menjadi catatan absen manual pada jam yang diajukan. */
export const JENIS_KET = { telat: "Terlambat", izin: "Izin tidak masuk", sakit: "Sakit", error: "Absen error / lupa absen", lain: "Lainnya" };
const AKSI_KET = {
  ajukan: (b, user) => tx(() => {
    if (!JENIS_KET[b.jenis]) throw bad("Pilih jenis keterangan");
    const u = one("SELECT id, nama FROM users WHERE id = ? AND aktif = 1", [+(b.user_id || user.id)]); if (!u) throw bad("Pilih nama karyawan");
    const tgl = tanggal(b.tgl || sekarang().tgl), alasan = teks(b.alasan, { wajib: true, max: 300, nama: "Alasan" });
    const arah = b.jenis === "error" ? (b.arah === "pulang" ? "pulang" : "masuk") : null;
    const jam = b.jenis === "error" ? jamValid(b.jam, "Jam absen yang seharusnya") : null;
    const id = Number(run("INSERT INTO absen_ket(tgl, user_id, jenis, arah, jam, alasan, oleh) VALUES (?,?,?,?,?,?,?)", [tgl, u.id, b.jenis, arah, jam, alasan, user.nama]).lastInsertRowid);
    antreNotif(`📝 Keterangan absen · ${u.nama}`, `${JENIS_KET[b.jenis]}${jam ? " (" + arah + " " + jam + ")" : ""} · ${tgl}\n${alasan}`, `/#absen?tgl=${tgl}&u=${u.id}`);
    return { id };
  }),
  daftar: ({ dari, sampai }, user) => all(`SELECT k.*, u.nama FROM absen_ket k JOIN users u ON u.id = k.user_id WHERE k.tgl BETWEEN ? AND ?${user.peran === "admin" ? "" : " AND (k.user_id = " + Number(user.id) + ")"} ORDER BY k.tgl DESC, k.id DESC LIMIT 300`, [tanggal(dari), tanggal(sampai || dari)]),
  putus: ({ id, status }, user) => tx(() => {
    if (user.peran !== "admin") throw new HttpError(403, "Hanya admin");
    const k = one("SELECT * FROM absen_ket WHERE id = ?", [+id]); if (!k) throw notFound("Keterangan tidak ditemukan");
    if (!["diterima", "ditolak", "menunggu"].includes(status)) throw bad("Status tidak valid");
    let absenId = k.absen_id;
    if (k.absen_id && status !== "diterima") { run("UPDATE absen SET dihapus = datetime('now'), oleh = ? WHERE id = ?", [user.nama, k.absen_id]); absenId = null; }
    if (status === "diterima" && k.jenis === "error" && k.jam && !k.absen_id)
      absenId = Number(run("INSERT INTO absen(tgl, jam, user_id, sumber, jenis, ket, oleh) VALUES (?,?,?, 'manual', ?, ?, ?)", [k.tgl, k.jam + ":00", k.user_id, k.arah || "masuk", `Absen error: ${k.alasan}`.slice(0, 120), user.nama]).lastInsertRowid);
    run("UPDATE absen_ket SET status = ?, putus_oleh = ?, putus_at = datetime('now'), absen_id = ? WHERE id = ?", [status, user.nama, absenId, k.id]);
    return { ok: true };
  }),
};
const jalankanKet = async (aksi, data, user) => {
  if (!cabangAktif()) return AKSI_KET[aksi](data, user);
  const nk = (one("SELECT nama_key FROM users WHERE id = ?", [user.id]) || {}).nama_key || "";
  const u = data && data.user_id ? (one("SELECT nama_key FROM users WHERE id = ?", [+data.user_id]) || {}).nama_key : null;
  return mintaPusat("/api/cabang/absen-ket", { aksi, data: { ...data, user_nk: u }, user: { nama_key: nk } });
};
/** Di server pusat untuk permintaan dari perangkat kasir (pengguna dicocokkan dengan nama). */
export function aksiKetDariPerangkat(aksi, data, u){
  if (!AKSI_KET[aksi]) throw bad("Aksi tidak dikenal");
  const user = one("SELECT id, nama, peran FROM users WHERE nama_key = ? AND aktif = 1", [String((u && u.nama_key) || "")]);
  if (!user) throw new HttpError(403, "Pengguna perangkat tidak dikenal di server");
  const d = { ...(data || {}) };
  if (d.user_nk) { const t = one("SELECT id FROM users WHERE nama_key = ?", [d.user_nk]); d.user_id = t ? t.id : null; }
  return AKSI_KET[aksi](d, user);
}
route("POST", "/api/absen/keterangan", "semua", ({ body, user }) => jalankanKet("ajukan", body, user));
route("GET", "/api/absen/keterangan", "semua", ({ query, user }) => jalankanKet("daftar", { dari: query.dari || sekarang().tgl, sampai: query.sampai }, user));
route("POST", "/api/absen/keterangan/:id/putus", "admin", ({ params, body, user }) => jalankanKet("putus", { id: +params.id, status: body.status }, user));

/* Absen oleh admin (mis. HP karyawan rusak / mesin mati) dan hapus scan yang keliru.
   Jam absen selalu jam saat itu juga (tidak bisa diisi manual); admin hanya memilih masuk atau pulang. */
route("POST", "/api/absen/manual", "admin", ({ body, user }) => {
  const u = one("SELECT id FROM users WHERE id = ?", [+body.user_id]);
  if (!u) throw bad("Pilih karyawan");
  if (body.jenis !== "masuk" && body.jenis !== "pulang") throw bad("Pilih absen masuk atau pulang");
  const ket = teks(body.ket, { max: 120, nama: "Keterangan" });
  const w = sekarang();
  const id = Number(run("INSERT INTO absen(tgl, jam, user_id, sumber, jenis, ket, oleh) VALUES (?,?,?, 'manual', ?, ?, ?)", [w.tgl, w.jam.slice(0, 5) + ":00", u.id, body.jenis, ket, user.nama]).lastInsertRowid);
  return { id, tgl: w.tgl, jam: w.jam.slice(0, 5), jenis: body.jenis };
});
route("DELETE", "/api/absen/:id", "admin", ({ params, user }) => {
  const a = one("SELECT id FROM absen WHERE id = ? AND dihapus IS NULL", [+params.id]);
  if (!a) throw notFound("Data absen tidak ditemukan");
  run("UPDATE absen SET dihapus = datetime('now'), oleh = ? WHERE id = ?", [user.nama, a.id]);
  return { ok: true };
});

/** Hemat penyimpanan: foto selfie absen dihapus otomatis sehari setelah gajian (bawaan tanggal 16),
 *  untuk semua absen sebelum periode gaji yang sedang berjalan. Data jam absennya tetap ada.
 *  Contoh: periode 15 Okt–14 Nov digaji 15 Nov → mulai 16 Nov foto absen sampai 14 Nov dihapus. */
export function hapusFotoAbsenLama(){
  const s = getSettings();
  const kemarin = tambahHari(sekarang().tgl, -1);
  const [batas] = periodeDari(kemarin, s.periode_mulai);
  const r = run("UPDATE absen SET foto = NULL WHERE foto IS NOT NULL AND tgl < ?", [batas]);
  return Number(r.changes || 0);
}
