import { one, run } from "./db.js";

/* Hapus transaksi & catatan LAMA (sebelum tanggal tertentu). Stok, barang, akun, dan pengaturan tidak berubah.
   Dipakai di server (Pengaturan → Hard reset → hanya sebelum tanggal) dan di perangkat kasir saat sinkron. */
export const TABEL_BERTANGGAL = ["sales", "stock_moves", "produksi", "insentif_bayar", "insentif_lain", "kasbon", "gaji_bayar", "expenses", "absen"];

/** Jumlah baris per tabel yang tanggalnya sebelum `sebelum` (YYYY-MM-DD). */
export function hitungSebelum(sebelum){
  const n = {};
  for (const t of TABEL_BERTANGGAL) n[t] = one(`SELECT COUNT(*) n FROM ${t} WHERE tgl < ?`, [sebelum]).n;
  return n;
}
/** Hapus baris yang tanggalnya sebelum `sebelum`. Panggil di dalam tx(). */
export function hapusSebelum(sebelum){
  const n = hitungSebelum(sebelum);
  run(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE tgl < ?)`, [sebelum]);
  for (const t of TABEL_BERTANGGAL) run(`DELETE FROM ${t} WHERE tgl < ?`, [sebelum]);
  return n;
}
export const tanggalValid = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
