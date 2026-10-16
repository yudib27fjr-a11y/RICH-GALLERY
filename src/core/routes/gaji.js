/* Penggajian karyawan (khusus admin).
   Gaji kotor  = gaji pokok + insentif produksi + insentif lain + lembur + bonus
   Gaji bersih = gaji kotor − potongan kasbon/hutang
   Gaji dibayar tanggal mulai periode (bawaan tanggal 15) untuk periode sebelumnya, tunai atau transfer.
   Setiap pembayaran gaji & kasbon otomatis tercatat di Pengeluaran dengan keterangan singkat.
   Data gaji ada di server pusat; di perangkat cabang rekap diambil dari server, perubahan hanya di server. */
import { route } from "../router.js";
import { one, all, run, tx, getSettings } from "../db.js";
import { bad, notFound, teks, angka, tanggal, sekarang } from "../util.js";
import { antre } from "../stok.js";
import { periodeDari, tambahHari } from "../../../public/shared.js";
import { rekapInsentif } from "./produksi.js";
import { rekapAbsen } from "./absen.js";
import { cabangAktif, mintaPusat } from "../cabang-perangkat.js";

export const METODE_GAJI = ["Tunai", "Transfer"];
const rpTeks = n => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
const tglPendek = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Sisa hutang (kasbon) satu karyawan: pinjam − (bayar + potong gaji). */
export function saldoKasbon(userId){
  const r = one(`SELECT COALESCE(SUM(CASE WHEN jenis = 'pinjam' THEN nominal ELSE -nominal END), 0) n FROM kasbon WHERE user_id = ? AND dihapus IS NULL`, [userId]);
  return r.n;
}

/** Rincian gaji satu periode untuk semua karyawan (atau satu karyawan). */
export function rekapGaji(tglDalam, hanyaUser = null){
  const s = getSettings();
  const [dari, sampai] = periodeDari(tglDalam, s.periode_mulai);
  const absen = rekapAbsen(dari, sampai);
  const lembur = absen.ringkas.filter(r => r.lembur > 0).map(r => ({ nama_key: r.nama_key, user_id: r.user_id, menit: r.lembur, rp: r.lembur_rp }));
  const ins = rekapInsentif(dari, null, lembur);
  const perIns = new Map(ins.rows.map(r => [r.pembuat_id, r]));
  const hadir = new Map(absen.ringkas.map(r => [r.user_id, r]));
  const users = all(`SELECT id, nama, peran, aktif, gaji_pokok FROM users
    WHERE (aktif = 1 AND (peran = 'karyawan' OR gaji_pokok > 0)) OR id IN (SELECT user_id FROM gaji_bayar WHERE periode_dari = ? AND batal_at IS NULL) ORDER BY nama`, [dari])
    .filter(u => !hanyaUser || u.id === hanyaUser);
  for (const r of ins.rows) if (r.total > 0 && !users.some(u => u.id === r.pembuat_id) && (!hanyaUser || r.pembuat_id === hanyaUser)) {
    const u = one("SELECT id, nama, peran, aktif, gaji_pokok FROM users WHERE id = ?", [r.pembuat_id]); if (u) users.push(u);
  }
  const rows = users.map(u => {
    const i = perIns.get(u.id) || { qty: 0, insentif: 0, lain: 0, lainDetail: [], lembur_menit: 0, lembur_rp: 0, bayar: null };
    const bayar = one("SELECT * FROM gaji_bayar WHERE user_id = ? AND periode_dari = ? AND batal_at IS NULL", [u.id, dari]);
    const h = hadir.get(u.id);
    const dasar = { user_id: u.id, nama: u.nama, peran: u.peran, gaji_pokok: u.gaji_pokok, hadir: h ? h.hadir : 0, terlambat: h ? h.terlambat : 0, hutang: saldoKasbon(u.id), lainDetail: i.lainDetail };
    if (bayar) return { ...dasar, pokok: bayar.pokok, qty: bayar.qty, ins_produksi: bayar.ins_produksi, ins_lain: bayar.ins_lain, lembur_menit: bayar.lembur_menit, lembur: bayar.lembur,
      bonus: bayar.bonus, kotor: bayar.kotor, potong_hutang: bayar.potong_hutang, bersih: bayar.bersih, bayar };
    // Insentif periode ini yang sudah dibayar terpisah (cara lama) tidak dihitung lagi.
    const terpisah = i.bayar ? i.bayar.nominal : 0;
    const ins_produksi = terpisah ? 0 : i.insentif, ins_lain = terpisah ? 0 : i.lain, lemburRp = terpisah ? 0 : i.lembur_rp;
    const kotor = u.gaji_pokok + ins_produksi + ins_lain + lemburRp;
    return { ...dasar, pokok: u.gaji_pokok, qty: i.qty, ins_produksi, ins_lain, lembur_menit: i.lembur_menit, lembur: lemburRp, bonus: 0, kotor,
      potong_hutang: 0, bersih: kotor, insentif_terpisah: terpisah, bayar: null };
  });
  return { dari, sampai, tgl_gajian: tambahHari(sampai, 1), lembur_per_jam: Number(s.lembur_per_jam) || 0, lemburTersedia: true, rows };
}

/** Daftar kasbon & sisa hutang tiap karyawan. */
export function daftarKasbon(userId = null){
  const rows = all(`SELECT k.id, k.tgl, k.user_id, u.nama, k.jenis, k.nominal, k.ket, k.metode, k.gaji_id, k.oleh, k.dibuat
    FROM kasbon k JOIN users u ON u.id = k.user_id WHERE k.dihapus IS NULL ${userId ? "AND k.user_id = ?" : ""} ORDER BY k.tgl DESC, k.id DESC LIMIT 500`, userId ? [userId] : []);
  const saldo = all(`SELECT u.id user_id, u.nama, SUM(CASE WHEN k.jenis = 'pinjam' THEN k.nominal ELSE -k.nominal END) sisa
    FROM kasbon k JOIN users u ON u.id = k.user_id WHERE k.dihapus IS NULL GROUP BY u.id HAVING sisa <> 0 ORDER BY u.nama`);
  return { rows, saldo };
}

route("GET", "/api/gaji", "admin", async ({ query }) => {
  const tgl = tanggal(query.tgl || sekarang().tgl);
  if (cabangAktif()) return { ...(await mintaPusat("/api/cabang/gaji", { tgl })), dariPusat: true };
  return rekapGaji(tgl);
});

route("GET", "/api/kasbon", "admin", async ({ query }) => {
  if (cabangAktif()) return { ...(await mintaPusat("/api/cabang/kasbon", {})), dariPusat: true };
  return daftarKasbon(query.user_id ? +query.user_id : null);
});

/* Gaji pokok per karyawan (per periode gaji / bulan). */
route("PUT", "/api/gaji/pokok", "admin", ({ body }) => tx(() => {
  const daftarPokok = Array.isArray(body.pokok) ? body.pokok : [];
  for (const x of daftarPokok) {
    const u = one("SELECT id, nama FROM users WHERE id = ?", [+(x && x.user_id)]);
    if (!u) throw notFound("Karyawan tidak ditemukan");
    run("UPDATE users SET gaji_pokok = ? WHERE id = ?", [angka(x.gaji_pokok, { min: 0, max: 1e9, bulat: true, nama: `Gaji pokok ${u.nama}` }) ?? 0, u.id]);
  }
  return { ok: true };
}), { pusatSaja: true });

/* Bayar gaji satu karyawan untuk satu periode. */
route("POST", "/api/gaji/bayar", "admin", ({ body, user }) => tx(() => {
  const s = getSettings();
  const [dari] = periodeDari(tanggal(body.periode_dari, { nama: "Periode" }), s.periode_mulai);
  const rek = rekapGaji(dari, +body.user_id);
  const r = rek.rows[0];
  if (!r) throw bad("Karyawan tidak ditemukan");
  if (r.bayar) throw bad(`Gaji ${r.nama} periode ini sudah dibayar`);
  const metode = METODE_GAJI.includes(body.metode) ? body.metode : null;
  if (!metode) throw bad("Pilih cara bayar: Tunai atau Transfer");
  const tgl = tanggal(body.tgl || sekarang().tgl, { nama: "Tanggal bayar" });
  const bonus = angka(body.bonus, { min: 0, max: 1e9, bulat: true, nama: "Bonus" }) ?? 0;
  const bonusKet = teks(body.bonus_ket, { max: 120, nama: "Keterangan bonus" });
  if (bonus && !bonusKet) throw bad("Tulis keterangan bonus (contoh: bonus target penjualan)");
  const ket = teks(body.ket, { max: 200, nama: "Catatan" });
  const kotor = r.kotor + bonus;
  const potong = angka(body.potong_hutang, { min: 0, max: 1e9, bulat: true, nama: "Potongan kasbon" }) ?? 0;
  if (potong > r.hutang) throw bad(`Potongan melebihi sisa hutang ${r.nama} (${rpTeks(r.hutang)})`);
  if (potong > kotor) throw bad("Potongan kasbon melebihi gaji kotor");
  if (!kotor) throw bad(`Belum ada gaji untuk ${r.nama} di periode ini. Isi gaji pokok atau catat insentif dulu.`);
  const bersih = kotor - potong;

  // Insentif & lembur periode ini ikut dibayar → catatan produksi & insentif lain periode ini terkunci.
  let insId = null;
  if (!one("SELECT 1 x FROM insentif_bayar WHERE pembuat_id = ? AND periode_dari = ?", [r.user_id, rek.dari])) {
    const nIns = r.ins_produksi + r.ins_lain + r.lembur;
    insId = Number(run(`INSERT INTO insentif_bayar(pembuat_id, periode_dari, periode_sampai, qty, hitung, nominal, tgl, ket, user_id, oleh) VALUES (?,?,?,?,?,?,?, 'Dibayar bersama gaji', ?, ?)`,
      [r.user_id, rek.dari, rek.sampai, r.qty || 0, nIns, nIns, tgl, user.id, user.nama]).lastInsertRowid);
  }
  const rincian = [r.pokok && `pokok ${rpTeks(r.pokok)}`, r.ins_produksi && `insentif ${rpTeks(r.ins_produksi)}`, r.ins_lain && `insentif lain ${rpTeks(r.ins_lain)}`,
    r.lembur && `lembur ${rpTeks(r.lembur)}`, bonus && `bonus ${rpTeks(bonus)}`].filter(Boolean).join(" + ") + (potong ? ` − kasbon ${rpTeks(potong)}` : "");
  const desk = `Gaji ${r.nama} ${tglPendek(rek.dari)}–${tglPendek(rek.sampai)} (${metode}): ${rincian}`.slice(0, 200);
  let expenseId = null;
  if (bersih > 0) {
    expenseId = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh) VALUES (?, 'Gaji Karyawan', ?, ?, ?, ?)", [tgl, desk, bersih, user.id, user.nama]).lastInsertRowid);
    antre("pengeluaran", [[String(expenseId), tgl, "Gaji Karyawan", desk, bersih, user.nama]]);
  }
  const gajiId = Number(run(`INSERT INTO gaji_bayar(user_id, periode_dari, periode_sampai, tgl, pokok, ins_produksi, qty, ins_lain, lembur_menit, lembur, bonus, bonus_ket, kotor, potong_hutang, bersih, metode, ket, expense_id, insentif_bayar_id, oleh)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [r.user_id, rek.dari, rek.sampai, tgl, r.pokok, r.ins_produksi, r.qty || 0, r.ins_lain, r.lembur_menit, r.lembur, bonus, bonusKet, kotor, potong, bersih, metode, ket, expenseId, insId, user.nama]).lastInsertRowid);
  if (potong) {
    run("INSERT INTO kasbon(tgl, user_id, jenis, nominal, ket, metode, gaji_id, oleh) VALUES (?,?, 'potong', ?, ?, 'Potong gaji', ?, ?)",
      [tgl, r.user_id, potong, `Potong gaji ${tglPendek(rek.dari)}–${tglPendek(rek.sampai)}`, gajiId, user.nama]);
    antre("kasbon", [[tgl, r.nama, "Potong gaji", potong, saldoKasbon(r.user_id), "Potong gaji", `Gaji ${tglPendek(rek.dari)}–${tglPendek(rek.sampai)}`, user.nama]]);
  }
  antre("gaji", [[tgl, r.nama, rek.dari, rek.sampai, r.pokok, r.ins_produksi, r.ins_lain, r.lembur, bonus, kotor, potong, bersih, metode, [bonusKet && "Bonus: " + bonusKet, ket].filter(Boolean).join(" · "), user.nama]]);
  return { ok: true, id: gajiId, kotor, bersih };
}), { pusatSaja: true });

/* Batalkan pembayaran gaji (salah input): pengeluaran & potongan kasbon ikut dibatalkan, periode dibuka lagi. */
route("DELETE", "/api/gaji/:id", "admin", ({ params, user }) => tx(() => {
  const g = one("SELECT g.*, u.nama FROM gaji_bayar g JOIN users u ON u.id = g.user_id WHERE g.id = ? AND g.batal_at IS NULL", [+params.id]);
  if (!g) throw notFound("Pembayaran gaji tidak ditemukan");
  run("UPDATE gaji_bayar SET batal_at = datetime('now'), batal_oleh = ? WHERE id = ?", [user.nama, g.id]);
  if (g.expense_id) { run("UPDATE expenses SET dihapus = datetime('now') WHERE id = ?", [g.expense_id]); antre("hapus_pengeluaran", [[String(g.expense_id), sekarang().tgl, user.nama]]); }
  run("UPDATE kasbon SET dihapus = datetime('now') WHERE gaji_id = ? AND dihapus IS NULL", [g.id]);
  if (g.insentif_bayar_id) run("DELETE FROM insentif_bayar WHERE id = ?", [g.insentif_bayar_id]);
  return { ok: true };
}), { pusatSaja: true });

/* Kasbon (pinjam) dan cicilan (bayar) di luar potong gaji. */
route("POST", "/api/kasbon", "admin", ({ body, user }) => tx(() => {
  const u = one("SELECT id, nama FROM users WHERE id = ?", [+body.user_id]);
  if (!u) throw bad("Pilih karyawan");
  const jenis = body.jenis === "bayar" ? "bayar" : body.jenis === "pinjam" ? "pinjam" : null;
  if (!jenis) throw bad("Pilih kasbon baru atau bayar cicilan");
  const tgl = tanggal(body.tgl || sekarang().tgl);
  const nominal = angka(body.nominal, { min: 1, max: 1e9, bulat: true, wajib: true, nama: "Nominal" });
  const ket = teks(body.ket, { max: 150, wajib: true, nama: "Keterangan" });
  const metode = METODE_GAJI.includes(body.metode) ? body.metode : "Tunai";
  if (jenis === "bayar" && nominal > saldoKasbon(u.id)) throw bad(`Cicilan melebihi sisa hutang ${u.nama} (${rpTeks(saldoKasbon(u.id))})`);
  let expenseId = null;
  if (jenis === "pinjam") {
    const desk = `Kasbon ${u.nama}: ${ket} (${metode})`.slice(0, 200);
    expenseId = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh) VALUES (?, 'Kasbon Karyawan', ?, ?, ?, ?)", [tgl, desk, nominal, user.id, user.nama]).lastInsertRowid);
    antre("pengeluaran", [[String(expenseId), tgl, "Kasbon Karyawan", desk, nominal, user.nama]]);
  }
  const id = Number(run("INSERT INTO kasbon(tgl, user_id, jenis, nominal, ket, metode, expense_id, oleh) VALUES (?,?,?,?,?,?,?,?)", [tgl, u.id, jenis, nominal, ket, metode, expenseId, user.nama]).lastInsertRowid);
  const sisa = saldoKasbon(u.id);
  antre("kasbon", [[tgl, u.nama, jenis === "pinjam" ? "Kasbon" : "Bayar cicilan", nominal, sisa, metode, ket, user.nama]]);
  return { id, sisa };
}), { pusatSaja: true });

route("DELETE", "/api/kasbon/:id", "admin", ({ params, user }) => tx(() => {
  const k = one("SELECT * FROM kasbon WHERE id = ? AND dihapus IS NULL", [+params.id]);
  if (!k) throw notFound("Catatan kasbon tidak ditemukan");
  if (k.jenis === "potong") throw bad("Potongan ini dari pembayaran gaji. Batalkan pembayaran gajinya di menu Gaji.");
  if (k.jenis === "pinjam" && saldoKasbon(k.user_id) - k.nominal < 0) throw bad("Kasbon ini sudah dicicil/dipotong gaji. Hapus cicilannya dulu.");
  run("UPDATE kasbon SET dihapus = datetime('now') WHERE id = ?", [k.id]);
  if (k.expense_id) { run("UPDATE expenses SET dihapus = datetime('now') WHERE id = ?", [k.expense_id]); antre("hapus_pengeluaran", [[String(k.expense_id), sekarang().tgl, user.nama]]); }
  return { ok: true };
}), { pusatSaja: true });
