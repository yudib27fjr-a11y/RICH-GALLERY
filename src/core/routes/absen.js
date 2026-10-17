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

/* ================= Shift kerja & lembur =================
   Jam operasional toko 09.00–21.00. Shift diatur admin (bawaan: Shift 1 09.00–17.00, Shift 2 12.00–21.00).
   Lembur = datang lebih awal dari jam masuk shift + pulang lebih lambat dari jam pulang shift,
   dibulatkan ke bawah per blok (bawaan 30 menit), dibayar per jam sesuai tarif yang bisa diubah. */
const menit = j => { const [h, m] = String(j || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
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
  const users = all("SELECT id, nama, nama_key, peran, aktif, pin_absen, shift FROM users ORDER BY nama");
  const perPin = new Map(users.filter(u => u.pin_absen).map(u => [u.pin_absen, u]));
  const perId = new Map(users.map(u => [u.id, u]));
  const scan = all("SELECT id, tgl, jam, pin, user_id, sumber, ket, oleh, jenis, jarak, mesin, foto IS NOT NULL ada_foto FROM absen WHERE dihapus IS NULL AND tgl BETWEEN ? AND ? ORDER BY tgl, jam", [dari, sampai]);
  const hari = new Map(), takDikenal = new Map();
  for (const a of scan) {
    const u = a.user_id ? perId.get(a.user_id) : perPin.get(a.pin);
    if (!u) { const t = takDikenal.get(a.pin) || { pin: a.pin, jumlah: 0, terakhir: "" }; t.jumlah++; t.terakhir = `${a.tgl} ${a.jam}`; takDikenal.set(a.pin, t); continue; }
    const k = `${a.tgl}|${u.id}`;
    if (!hari.has(k)) hari.set(k, { tgl: a.tgl, user_id: u.id, nama: u.nama, nama_key: u.nama_key, pilihanShift: u.shift, scan: [] });
    hari.get(k).scan.push({ id: a.id, jam: a.jam.slice(0, 5), sumber: a.sumber, ket: a.ket, oleh: a.oleh, jenis: a.jenis, jarak: a.jarak, perangkat: a.sumber === "pin" ? a.mesin : "", foto: !!a.ada_foto });
  }
  const harian = [...hari.values()].map(({ pilihanShift, ...h }) => {
    const sc = h.scan, akhir = sc[sc.length - 1];
    const m = sc.find(x => x.jenis === "masuk") || sc.find(x => x.jenis !== "pulang");
    let p = [...sc].reverse().find(x => x.jenis === "pulang") || (sc.length > 1 && akhir !== m && akhir.jenis !== "masuk" ? akhir : null);
    if (p && m && p.jam < m.jam) p = null;
    const masuk = m ? m.jam : "", pulang = p ? p.jam : "";
    const shift = pilihShift(shifts, pilihanShift, masuk);
    const l = hitungLembur(shift, masuk, pulang, s.lembur_bulat);
    return { ...h, masuk, pulang, shift: shift.nama, shift_masuk: shift.masuk, shift_pulang: shift.pulang,
      terlambat: !!masuk && masuk > shift.masuk, pulangCepat: !!pulang && pulang < shift.pulang,
      lembur: l.menit, lembur_awal: l.awal, lembur_akhir: l.akhir };
  }).sort((a, b) => b.tgl.localeCompare(a.tgl) || a.nama.localeCompare(b.nama));
  const ringkas = new Map();
  for (const h of harian) {
    const r = ringkas.get(h.user_id) || { user_id: h.user_id, nama: h.nama, nama_key: h.nama_key, hadir: 0, terlambat: 0, tanpaPulang: 0, lembur: 0, lembur_rp: 0 };
    r.hadir++; if (h.terlambat) r.terlambat++; if (!h.pulang) r.tanpaPulang++; r.lembur += h.lembur;
    ringkas.set(h.user_id, r);
  }
  for (const r of ringkas.values()) r.lembur_rp = nilaiLembur(r.lembur, s.lembur_per_jam);
  return {
    dari, sampai, aktif: !!(s.absen_aktif || s.absen_pin_aktif), shifts, jam_buka: s.jam_buka, jam_tutup: s.jam_tutup,
    lembur_per_jam: Number(s.lembur_per_jam) || 0, lembur_bulat: Number(s.lembur_bulat) || 0,
    harian, ringkas: [...ringkas.values()].sort((a, b) => a.nama.localeCompare(b.nama)), takDikenal: [...takDikenal.values()],
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
    pin_aktif: !!s.absen_pin_aktif, lat: s.absen_lat, lng: s.absen_lng, radius: Number(s.absen_radius) || 100,
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
    ins_kurir: Number(s.ins_kurir) || 0, ins_lapangan: Number(s.ins_lapangan) || 0, ins_konten: Number(s.ins_konten) || 0,
    karyawan: all("SELECT id, nama, peran, aktif, shift FROM users ORDER BY aktif DESC, peran DESC, nama"),
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
  rp("lembur_per_jam", "Upah lembur per jam"); rp("ins_kurir", "Insentif kurir"); rp("ins_lapangan", "Insentif kerja lapangan"); rp("ins_konten", "Insentif buat konten");
  if (body.lembur_bulat != null) { const b = Number(body.lembur_bulat); if (![1, 15, 30, 60].includes(b)) throw bad("Pembulatan lembur: 1, 15, 30, atau 60 menit"); setSetting("lembur_bulat", b); }
  if (Array.isArray(body.shift_karyawan)) {
    const n = daftarShift().length;
    for (const x of body.shift_karyawan) {
      const v = String(x && x.shift || "");
      run("UPDATE users SET shift = ? WHERE id = ?", [Number(v) >= 1 && Number(v) <= n ? String(Number(v)) : "", +x.user_id]);
    }
  }
  return { ok: true };
}));

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
