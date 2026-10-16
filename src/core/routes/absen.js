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
  const scan = all("SELECT id, tgl, jam, pin, user_id, sumber, ket, oleh FROM absen WHERE dihapus IS NULL AND tgl BETWEEN ? AND ? ORDER BY tgl, jam", [dari, sampai]);
  const hari = new Map(), takDikenal = new Map();
  for (const a of scan) {
    const u = a.user_id ? perId.get(a.user_id) : perPin.get(a.pin);
    if (!u) { const t = takDikenal.get(a.pin) || { pin: a.pin, jumlah: 0, terakhir: "" }; t.jumlah++; t.terakhir = `${a.tgl} ${a.jam}`; takDikenal.set(a.pin, t); continue; }
    const k = `${a.tgl}|${u.id}`;
    if (!hari.has(k)) hari.set(k, { tgl: a.tgl, user_id: u.id, nama: u.nama, scan: [] });
    hari.get(k).scan.push({ id: a.id, jam: a.jam.slice(0, 5), sumber: a.sumber, ket: a.ket, oleh: a.oleh });
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
    dari, sampai, aktif: !!s.absen_aktif, jam_masuk: s.absen_jam_masuk, jam_pulang: s.absen_jam_pulang,
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
