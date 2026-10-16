/* Absensi sidik jari.
   Mesin absen (Fingerspot Revo + layanan developer.fingerspot.io) mengirim setiap scan ke server lewat webhook:
     POST /api/absen/mesin/<kunci-rahasia>   { "type": "attlog", "cloud_id": "...", "data": { "pin": "1", "scan": "2026-10-16 08:01", ... } }
   Setiap karyawan dihubungkan ke mesin lewat "PIN mesin" (nomor ID karyawan di mesin absen).
   Di perangkat cabang (iMin), rekap absensi diambil langsung dari server pusat. */
import { route } from "../router.js";
import { one, all, run, tx, getSettings, setSetting } from "../db.js";
import { platform } from "../platform.js";
import { HttpError, bad, notFound, teks, tanggal, sekarang } from "../util.js";
import { cabangAktif, mintaPusat } from "../cabang-perangkat.js";
import { cekPassword, cekBatasLogin, catatGagal, resetGagal } from "../auth.js";

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
export function cekLokasi(lat, lng, akurasi){
  const s = getSettings();
  const tLat = parseFloat(s.absen_lat), tLng = parseFloat(s.absen_lng), radius = Number(s.absen_radius) || 100;
  if (!isFinite(tLat) || !isFinite(tLng)) throw bad("Lokasi toko untuk absen belum diatur admin (Pengaturan → Absensi)");
  lat = Number(lat); lng = Number(lng); akurasi = Math.max(0, Number(akurasi) || 0);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad("Lokasi perangkat tidak terbaca. Nyalakan GPS / lokasi lalu coba lagi.");
  if (akurasi > 500) throw bad(`Lokasi kurang akurat (±${Math.round(akurasi)} m). Tunggu sebentar di dekat pintu/jendela lalu coba lagi.`);
  const jarak = jarakMeter(lat, lng, tLat, tLng);
  if (jarak > radius + Math.min(akurasi, 50)) throw bad(`Absen hanya bisa di toko. Perangkat berjarak ±${Math.round(jarak)} m dari lokasi toko (batas ${radius} m).`);
  return Math.round(jarak);
}
/** Status absen di perangkat ini (untuk tombol Absen di layar kasir). */
function statusKiosk(){
  const s = getSettings();
  const alasan = !s.absen_pin_aktif ? "Absen PIN belum diaktifkan admin"
    : !platform.perangkat ? "Absen hanya bisa dari aplikasi di perangkat kasir (iMin)"
    : !cabangAktif() ? "Perangkat ini belum tersambung ke server pusat"
    : !s.cabang_absen ? "Perangkat ini belum diizinkan untuk absen (admin: Pengaturan → Server pusat → Perangkat cabang)"
    : !(isFinite(parseFloat(s.absen_lat)) && isFinite(parseFloat(s.absen_lng))) ? "Lokasi toko untuk absen belum diatur"
    : "";
  return { aktif: !!s.absen_pin_aktif, boleh: !alasan, alasan, radius: Number(s.absen_radius) || 100, lat: parseFloat(s.absen_lat), lng: parseFloat(s.absen_lng) };
}
route("GET", "/api/absen/kiosk", false, () => {
  const st = statusKiosk();
  return st.boleh ? { ...st, staf: all("SELECT id, nama FROM users WHERE aktif = 1 AND pass_hash IS NOT NULL ORDER BY nama") } : st;
});
const FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
route("POST", "/api/absen/pin", false, ({ body, ctx }) => {
  const st = statusKiosk();
  if (!st.boleh) throw new HttpError(403, st.alasan);
  const u = one("SELECT id, nama, nama_key, pass_hash, aktif FROM users WHERE id = ?", [+body.user_id]);
  if (!u || !u.aktif) throw bad("Pilih nama karyawan");
  const kunci = (ctx.ip || "") + "|absen|" + u.nama_key;
  cekBatasLogin(kunci);
  if (!cekPassword(String(body.pin ?? ""), u.pass_hash)) { catatGagal(kunci); throw new HttpError(401, "PIN salah"); }
  resetGagal(kunci);
  const foto = String(body.foto || "");
  if (!FOTO.test(foto) || foto.length < 2000) throw bad("Ambil foto selfie dulu");
  if (foto.length > 400_000) throw bad("Foto terlalu besar");
  const jarak = cekLokasi(body.lat, body.lng, body.akurasi);
  const jenis = body.jenis === "pulang" ? "pulang" : "masuk";
  const w = sekarang(), uid = platform.token();
  const id = Number(run(`INSERT INTO absen(tgl, jam, user_id, sumber, jenis, foto, lat, lng, jarak, uid, mesin, oleh) VALUES (?,?,?, 'pin', ?,?,?,?,?,?,?,?)`,
    [w.tgl, w.jam.slice(0, 5) + ":00", u.id, jenis, foto, +body.lat, +body.lng, jarak, uid, getSettings().cabang_nama || "", u.nama]).lastInsertRowid);
  return { ok: true, id, uid, nama: u.nama, jenis, jam: w.jam.slice(0, 5), jarak };
}, { batas: 500_000, cabang: ({ hasil: h }) => {
  const a = one("SELECT a.tgl, a.jam, a.jenis, a.foto, a.lat, a.lng, u.nama_key FROM absen a JOIN users u ON u.id = a.user_id WHERE a.uid = ?", [h.uid]);
  return { aksi: "absen", data: { uid: h.uid, nama_key: a.nama_key, tgl: a.tgl, jam: a.jam.slice(0, 5), jenis: a.jenis, foto: a.foto, lat: a.lat, lng: a.lng } };
} });

/** Absen dari perangkat cabang diterima server (dipanggil dari /api/cabang/kirim). */
export function terimaAbsen(x, alat){
  if (!alat.absen) throw bad("Perangkat ini tidak diizinkan untuk absen");
  const u = one("SELECT id, nama FROM users WHERE nama_key = ?", [String(x.nama_key || "")]);
  if (!u) throw bad("Karyawan tidak dikenal di server");
  const jarak = cekLokasi(x.lat, x.lng, 0);
  run(`INSERT OR IGNORE INTO absen(tgl, jam, user_id, sumber, jenis, foto, lat, lng, jarak, uid, mesin, oleh) VALUES (?,?,?, 'pin', ?,?,?,?,?,?,?,?)`,
    [tanggal(x.tgl), String(x.jam || "00:00").slice(0, 5) + ":00", u.id, x.jenis === "pulang" ? "pulang" : "masuk", String(x.foto || "").slice(0, 400_000), +x.lat, +x.lng, jarak, String(x.uid), alat.nama, u.nama]);
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
  return Number(r.changes || 0) > 0;
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

/** Rekap absensi: jam masuk = scan pertama hari itu, jam pulang = scan terakhir (bila lebih dari satu scan). */
export function rekapAbsen(dari, sampai){
  const s = getSettings();
  const users = all("SELECT id, nama, peran, aktif, pin_absen FROM users ORDER BY nama");
  const perPin = new Map(users.filter(u => u.pin_absen).map(u => [u.pin_absen, u]));
  const perId = new Map(users.map(u => [u.id, u]));
  const scan = all("SELECT id, tgl, jam, pin, user_id, sumber, ket, oleh, jenis, jarak, mesin, foto IS NOT NULL ada_foto FROM absen WHERE dihapus IS NULL AND tgl BETWEEN ? AND ? ORDER BY tgl, jam", [dari, sampai]);
  const hari = new Map(), takDikenal = new Map();
  for (const a of scan) {
    const u = a.user_id ? perId.get(a.user_id) : perPin.get(a.pin);
    if (!u) { const t = takDikenal.get(a.pin) || { pin: a.pin, jumlah: 0, terakhir: "" }; t.jumlah++; t.terakhir = `${a.tgl} ${a.jam}`; takDikenal.set(a.pin, t); continue; }
    const k = `${a.tgl}|${u.id}`;
    if (!hari.has(k)) hari.set(k, { tgl: a.tgl, user_id: u.id, nama: u.nama, scan: [] });
    hari.get(k).scan.push({ id: a.id, jam: a.jam.slice(0, 5), sumber: a.sumber, ket: a.ket, oleh: a.oleh, jenis: a.jenis, jarak: a.jarak, perangkat: a.sumber === "pin" ? a.mesin : "", foto: !!a.ada_foto });
  }
  const harian = [...hari.values()].map(h => {
    const masuk = h.scan[0].jam, pulang = h.scan.length > 1 ? h.scan[h.scan.length - 1].jam : "";
    return { ...h, masuk, pulang, terlambat: masuk > s.absen_jam_masuk, pulangCepat: !!pulang && pulang < s.absen_jam_pulang };
  }).sort((a, b) => b.tgl.localeCompare(a.tgl) || a.nama.localeCompare(b.nama));
  const ringkas = new Map();
  for (const h of harian) {
    const r = ringkas.get(h.user_id) || { user_id: h.user_id, nama: h.nama, hadir: 0, terlambat: 0, tanpaPulang: 0 };
    r.hadir++; if (h.terlambat) r.terlambat++; if (!h.pulang) r.tanpaPulang++;
    ringkas.set(h.user_id, r);
  }
  return {
    dari, sampai, aktif: !!(s.absen_aktif || s.absen_pin_aktif), jam_masuk: s.absen_jam_masuk, jam_pulang: s.absen_jam_pulang,
    harian, ringkas: [...ringkas.values()].sort((a, b) => a.nama.localeCompare(b.nama)), takDikenal: [...takDikenal.values()],
  };
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
    jam_masuk: s.absen_jam_masuk, jam_pulang: s.absen_jam_pulang, terakhir,
    pin_aktif: !!s.absen_pin_aktif, lat: s.absen_lat, lng: s.absen_lng, radius: Number(s.absen_radius) || 100,
    karyawan: all("SELECT id, nama, peran, aktif, pin_absen FROM users ORDER BY aktif DESC, peran DESC, nama"),
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

/* Absen manual oleh admin (lupa scan / mesin rusak) dan hapus scan yang keliru. */
route("POST", "/api/absen/manual", "admin", ({ body, user }) => {
  const u = one("SELECT id FROM users WHERE id = ?", [+body.user_id]);
  if (!u) throw bad("Pilih karyawan");
  const tgl = tanggal(body.tgl, { nama: "Tanggal" }), jam = jamValid(body.jam, "Jam");
  const ket = teks(body.ket, { max: 120, nama: "Keterangan" });
  const id = Number(run("INSERT INTO absen(tgl, jam, user_id, sumber, ket, oleh) VALUES (?,?,?, 'manual', ?, ?)", [tgl, jam + ":00", u.id, ket, user.nama]).lastInsertRowid);
  return { id };
});
route("DELETE", "/api/absen/:id", "admin", ({ params, user }) => {
  const a = one("SELECT id FROM absen WHERE id = ? AND dihapus IS NULL", [+params.id]);
  if (!a) throw notFound("Data absen tidak ditemukan");
  run("UPDATE absen SET dihapus = datetime('now'), oleh = ? WHERE id = ?", [user.nama, a.id]);
  return { ok: true };
});
