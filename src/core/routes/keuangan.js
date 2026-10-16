import { route } from "../router.js";
import { one, all, run, tx } from "../db.js";
import { HttpError, bad, notFound, teks, angka, tanggal, pilihan, hariIni } from "../util.js";
import { antre } from "../stok.js";
import { KAT_PENGELUARAN, tambahHari } from "../../../public/shared.js";

/* ---- Pengeluaran (admin) ---- */
route("GET", "/api/pengeluaran", "admin", ({ query }) => {
  const dari = tanggal(query.dari), sampai = tanggal(query.sampai);
  // sumber: pengeluaran otomatis dari pembayaran gaji / kasbon / insentif (dihapus lewat menunya masing-masing)
  return all(`SELECT e.id, e.tgl, e.kategori, e.ket, e.nominal, e.oleh,
    CASE WHEN EXISTS (SELECT 1 FROM gaji_bayar g WHERE g.expense_id = e.id) THEN 'gaji'
      WHEN EXISTS (SELECT 1 FROM kasbon k WHERE k.expense_id = e.id) THEN 'kasbon'
      WHEN EXISTS (SELECT 1 FROM insentif_bayar b WHERE b.expense_id = e.id) THEN 'insentif' ELSE '' END sumber
    FROM expenses e WHERE e.dihapus IS NULL AND e.tgl BETWEEN ? AND ? ORDER BY e.tgl DESC, e.id DESC`, [dari, sampai]);
});
route("POST", "/api/pengeluaran", "admin", ({ body, user }) => tx(() => {
  const tgl = tanggal(body.tgl);
  const kategori = pilihan(body.kategori, KAT_PENGELUARAN, "Kategori");
  const ket = teks(body.ket, { max: 200, wajib: true, nama: "Keterangan singkat" });
  const nominal = angka(body.nominal, { min: 1, max: 1e11, bulat: true, wajib: true, nama: "Nominal" });
  const uid = body.uid ? teks(body.uid, { max: 80, nama: "uid" }) : null;
  const id = Number(run("INSERT INTO expenses(tgl, kategori, ket, nominal, user_id, oleh, uid) VALUES (?,?,?,?,?,?,?)", [tgl, kategori, ket, nominal, user.id, user.nama, uid]).lastInsertRowid);
  antre("pengeluaran", [[String(id), tgl, kategori, ket, nominal, user.nama]]);
  return { id };
}), { uid: true, cabang: ({ body }) => ({ aksi: "pengeluaran", data: { uid: body.uid, tgl: body.tgl, kategori: body.kategori, ket: body.ket || "", nominal: body.nominal } }) });
route("DELETE", "/api/pengeluaran/:id", "admin", ({ params, user }) => tx(() => {
  const e = one("SELECT * FROM expenses WHERE id = ? AND dihapus IS NULL", [+params.id]);
  if (!e) throw notFound("Pengeluaran tidak ditemukan");
  if (one("SELECT 1 x FROM insentif_bayar WHERE expense_id = ?", [e.id])) throw bad("Pengeluaran ini tercatat dari pembayaran insentif dan tidak bisa dihapus di sini");
  if (one("SELECT 1 x FROM gaji_bayar WHERE expense_id = ? AND batal_at IS NULL", [e.id])) throw bad("Pengeluaran ini dari pembayaran gaji. Batalkan pembayarannya di menu Gaji.");
  if (one("SELECT 1 x FROM kasbon WHERE expense_id = ? AND dihapus IS NULL", [e.id])) throw bad("Pengeluaran ini dari kasbon karyawan. Hapus kasbonnya di menu Gaji.");
  run("UPDATE expenses SET dihapus = datetime('now') WHERE id = ?", [e.id]);
  antre("hapus_pengeluaran", [[String(e.id), hariIni(), user.nama]]);
  return { ok: true };
}), {
  pra: ({ params }) => one("SELECT uid FROM expenses WHERE id = ?", [+params.id]),
  cabang: ({ pra }) => {
    if (!pra || !pra.uid) throw new HttpError(409, "Pengeluaran ini dibuat sebelum perangkat tersambung ke server pusat. Hapus dari server pusat.");
    return { aksi: "hapus_pengeluaran", data: { uid: pra.uid } };
  },
});

/* ---- Laporan (admin) ---- */
route("GET", "/api/laporan", "admin", ({ query }) => {
  const dari = tanggal(query.dari), sampai = tanggal(query.sampai);
  if (dari > sampai) throw bad("Tanggal awal harus sebelum tanggal akhir");
  const p = [dari, sampai];
  const S = "FROM sales s WHERE s.batal_at IS NULL AND s.tgl BETWEEN ? AND ?";
  const I = "FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.batal_at IS NULL AND s.tgl BETWEEN ? AND ?";
  const ring = one(`SELECT COUNT(*) transaksi, COALESCE(SUM(total),0) omzet, COALESCE(SUM(diskon),0) diskon, COALESCE(SUM(ongkir),0) ongkir,
    COALESCE(SUM(MAX(0, total - bayar)),0) piutang ${S}`, p);
  const it = one(`SELECT COALESCE(SUM(i.harga * i.qty),0) bruto, COALESCE(SUM(i.qty),0) qty, COALESCE(SUM(i.hpp * i.qty),0) hpp ${I}`, p);
  const biaya = one("SELECT COALESCE(SUM(nominal),0) n FROM expenses WHERE dihapus IS NULL AND tgl BETWEEN ? AND ?", p).n;
  const labaKotor = Math.round(it.bruto - ring.diskon - it.hpp);

  // Grafik: per hari untuk rentang <= 62 hari, selain itu per bulan.
  const hari = (new Date(sampai) - new Date(dari)) / 86400000 + 1;
  let grafik;
  if (hari <= 62) {
    const m = new Map(all(`SELECT tgl k, SUM(total) v ${S} GROUP BY tgl`, p).map(r => [r.k, r.v]));
    grafik = []; for (let d = dari; d <= sampai; d = tambahHari(d, 1)) grafik.push({ label: String(+d.slice(8)), k: d, v: m.get(d) || 0 });
  } else {
    const m = new Map(all(`SELECT SUBSTR(tgl,1,7) k, SUM(total) v ${S} GROUP BY k`, p).map(r => [r.k, r.v]));
    grafik = []; let [y, mo] = dari.slice(0, 7).split("-").map(Number);
    const akhir = sampai.slice(0, 7);
    for (let i = 0; i < 120; i++) { const k = `${y}-${String(mo).padStart(2, "0")}`; if (k > akhir) break; grafik.push({ label: k, k, v: m.get(k) || 0 }); if (++mo > 12) { mo = 1; y++; } }
  }
  const prod = one("SELECT COALESCE(SUM(qty),0) qty, COALESCE(SUM(qty * tarif),0) insentif FROM produksi WHERE tgl BETWEEN ? AND ?", p);
  return {
    dari, sampai, ...ring, ...it, biaya, labaKotor, labaBersih: labaKotor - biaya, grafik, produksi: prod,
    perKategori: all(`SELECT i.kategori, SUM(i.qty) qty, SUM(i.harga * i.qty) nilai ${I} GROUP BY i.kategori ORDER BY nilai DESC`, p),
    terlaris: all(`SELECT i.nama, SUM(i.qty) qty, SUM(i.harga * i.qty) nilai ${I} GROUP BY i.nama ORDER BY qty DESC, nilai DESC LIMIT 10`, p),
    perKasir: all(`SELECT kasir, COUNT(*) transaksi, SUM(total) nilai ${S} GROUP BY kasir ORDER BY nilai DESC`, p),
    perMetode: all(`SELECT metode, SUM(MIN(bayar, total)) nilai ${S} GROUP BY metode`, p),
    bahanKritis: all("SELECT kode, nama, stok, stok_min, satuan FROM materials WHERE dihapus IS NULL AND stok_min > 0 AND stok <= stok_min ORDER BY stok LIMIT 15"),
  };
});
